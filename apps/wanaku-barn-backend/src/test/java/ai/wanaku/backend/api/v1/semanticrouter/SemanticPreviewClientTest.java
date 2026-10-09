package ai.wanaku.backend.api.v1.semanticrouter;

import java.net.InetSocketAddress;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class SemanticPreviewClientTest {
    // Response-contract tests use the production default; only the deadline test needs a short timeout.
    @Test
    void sendsOnlyClassificationDataAndValidatesNativeLabels() throws Exception {
        var seen = new AtomicReference<String>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/preview", request -> {
            seen.set(new String(request.getRequestBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
            byte[] response =
                    "{\"resultType\":\"choice\",\"value\":\"billing\",\"diagnostics\":{\"providerToken\":\"sensitive\",\"confidence\":0.8,\"probabilities\":{\"billing\":0.8,\"technical\":0.2,\"injected\":1}}}"
                            .getBytes(java.nio.charset.StandardCharsets.UTF_8);
            request.sendResponseHeaders(200, response.length);
            request.getResponseBody().write(response);
            request.close();
        });
        server.start();
        try {
            SemanticPreviewClient client = client(server, 15);
            var result = client.evaluate(SemanticCatalogTest.definition(), "Invoice question");
            assertThat(result.error)
                    .as("Classification response after %s ms", result.durationMillis)
                    .isNull();
            assertThat(result.label).isEqualTo("billing");
            assertThat(result.diagnostics).containsEntry("confidence", 0.8).doesNotContainKey("providerToken");
            assertThat(result.diagnostics.get("probabilities")).isEqualTo(Map.of("billing", 0.8, "technical", 0.2));
            var payload = client.mapper.readTree(seen.get());
            assertThat(payload.size()).isEqualTo(4);
            assertThat(payload.path("expertBean").textValue()).isEqualTo("supportExpert");
            assertThat(payload.path("operation").textValue()).isEqualTo("choice");
            assertThat(payload.path("state").textValue()).isEqualTo("Invoice question");
            assertThat(payload.path("parameters"))
                    .isEqualTo(client.mapper.valueToTree(Map.of(
                            "instructions",
                            "Select the action for this support message",
                            "criteria",
                            Map.of(
                                    "billing", "billing requests",
                                    "technical", "technical requests",
                                    "no_match", "Neither action applies"))));
            assertThat(seen.get()).doesNotContain("configuration", "prefix", "actionId", "kamelet", "dispatch");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void providerFailureAndMalformedLabelsRemainErrors() throws Exception {
        for (String response : java.util.List.of(
                "{\"resultType\":\"choice\",\"value\":\"unconfigured\"}",
                "{\"resultType\":\"text\",\"value\":\"billing\"}",
                "{\"value\":\"billing\"}",
                "{\"resultType\":\"choice\"}",
                "{\"resultType\":\"choice\",\"value\":null}",
                "{\"resultType\":\"choice\",\"value\":42}",
                "{\"resultType\":\"choice\",\"value\":{\"label\":\"billing\"}}",
                "{\"resultType\":\"choice\",\"value\":[\"billing\"]}",
                "{\"label\":\"billing\"}",
                "not JSON")) {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/api/v1/preview", request -> {
                byte[] bytes = response.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                request.sendResponseHeaders(200, bytes.length);
                request.getResponseBody().write(bytes);
                request.close();
            });
            server.start();
            try {
                var result = client(server, 15).evaluate(SemanticCatalogTest.definition(), "Message");
                assertThat(result.error)
                        .as("Provider response: %s", response)
                        .isEqualTo(
                                "not JSON".equals(response)
                                        ? "Semantic evaluation failed"
                                        : "Semantic evaluation returned an invalid label");
                assertThat(result.label).isNull();
                assertThat(result.noMatch).isFalse();
            } finally {
                server.stop(0);
            }
        }
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/preview", request -> {
            byte[] bytes = "provider secret".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            request.sendResponseHeaders(502, bytes.length);
            request.getResponseBody().write(bytes);
            request.close();
        });
        server.start();
        try {
            var result = client(server, 15).evaluate(SemanticCatalogTest.definition(), "Message");
            assertThat(result.error).isEqualTo("Semantic evaluation failed").doesNotContain("secret");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void explicitNoMatchHasNoError() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/preview", request -> {
            byte[] bytes = "{\"resultType\":\"choice\",\"value\":\"no_match\"}"
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8);
            request.sendResponseHeaders(200, bytes.length);
            request.getResponseBody().write(bytes);
            request.close();
        });
        server.start();
        try {
            var result = client(server, 15).evaluate(SemanticCatalogTest.definition(), "Unrelated");
            assertThat(result.error)
                    .as("No-match response after %s ms", result.durationMillis)
                    .isNull();
            assertThat(result.noMatch).isTrue();
            assertThat(result.label).isEqualTo("no_match");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void previewConcurrencyAndResponseReadsAreBounded() throws Exception {
        java.util.concurrent.CountDownLatch entered = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/preview", request -> {
            entered.countDown();
            try {
                release.await(3, java.util.concurrent.TimeUnit.SECONDS);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
            }
            request.sendResponseHeaders(200, 0);
            request.close();
        });
        server.start();
        try (var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            SemanticPreviewClient client = client(server, 1);
            var pending = executor.submit(() -> client.evaluate(SemanticCatalogTest.definition(), "Waiting"));
            assertThat(entered.await(2, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            var busy = client.evaluate(SemanticCatalogTest.definition(), "Concurrent");
            assertThat(busy.error).isEqualTo("Classification preview is busy");
            var timedOut = pending.get(2, java.util.concurrent.TimeUnit.SECONDS);
            assertThat(timedOut.error).isEqualTo("Semantic evaluation failed");
            assertThat(timedOut.durationMillis).isLessThan(2000);
        } finally {
            release.countDown();
            server.stop(0);
        }
    }

    @Test
    void oversizedResponsesAreRejectedBeforeParsing() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/preview", request -> {
            byte[] bytes = new byte[70 * 1024];
            request.sendResponseHeaders(200, bytes.length);
            request.getResponseBody().write(bytes);
            request.close();
        });
        server.start();
        try {
            var result = client(server, 15).evaluate(SemanticCatalogTest.definition(), "Message");
            assertThat(result.error).isEqualTo("Semantic evaluation failed");
            assertThat(result.label).isNull();
        } finally {
            server.stop(0);
        }
    }

    static SemanticPreviewClient client(HttpServer server) {
        return client(server, 15);
    }

    static SemanticPreviewClient client(HttpServer server, int timeoutSeconds) {
        SemanticActionCatalog catalog = new SemanticActionCatalog();
        catalog.kamelets = ai.wanaku.backend.api.v1.kamelets.KameletTestSupport.catalog(
                ai.wanaku.backend.api.v1.kamelets.KameletTestSupport.repository(new java.util.LinkedHashMap<>()));
        catalog.parser = new ai.wanaku.backend.api.v1.kamelets.KameletParser();
        catalog.expertsFile = Optional.empty();
        catalog.init();
        SemanticPreviewClient client = new SemanticPreviewClient();
        client.catalog = catalog;
        client.mapper = new ObjectMapper();
        client.timeoutSeconds = timeoutSeconds;
        client.maxConcurrency = 1;
        client.url = Optional.of("http://127.0.0.1:" + server.getAddress().getPort() + "/api/v1/preview");
        client.token = Optional.empty();
        client.init();
        return client;
    }
}
