package ai.wanaku.backend.api.v1.semanticrouter;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import ai.wanaku.backend.api.v1.semanticrouter.model.SemanticExpert;
import ai.wanaku.backend.api.v1.semanticrouter.model.SemanticExpertOperation;
import ai.wanaku.backend.api.v1.semanticrouter.model.SemanticGuard;
import ai.wanaku.backend.api.v1.semanticrouter.model.SemanticRouterDefinition;
import ai.wanaku.backend.api.v1.servicecatalog.CatalogZipReader;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLMapper;
import com.sun.net.httpserver.HttpServer;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.spy;

class SemanticGuardTest {
    @Test
    void guardPolarityDefaultsToTrueAndRejectsExplicitNull() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        assertThat(mapper.readValue("{}", SemanticGuard.class).rejectWhen).isTrue();
        assertThat(mapper.readValue("{\"rejectWhen\":false}", SemanticGuard.class).rejectWhen)
                .isFalse();
        assertThatThrownBy(() -> mapper.readValue("{\"rejectWhen\":null}", SemanticGuard.class))
                .isInstanceOf(com.fasterxml.jackson.databind.JsonMappingException.class);
    }

    static SemanticExpert securityExpert() {
        SemanticExpert expert = new SemanticExpert();
        expert.id = "security";
        expert.name = "Security";
        expert.bean = "securityExpert";
        expert.dependency = "org.apache.camel:camel-wolf-defender:4.23.0-SNAPSHOT";
        SemanticExpertOperation injection = new SemanticExpertOperation();
        injection.name = "injection";
        injection.inputTypes = List.of("text");
        injection.resultType = "boolean";
        injection.resultMeaning = "True means injection";
        injection.parameterSchema = Map.of(
                "type",
                "object",
                "properties",
                Map.of("threshold", Map.of("type", "number", "minimum", 0, "maximum", 1)),
                "additionalProperties",
                false);
        expert.operations = List.of(injection);
        return expert;
    }

    static SemanticActionCatalog withSecurity(SemanticActionCatalog original) {
        SemanticActionCatalog catalog = spy(original);
        doReturn(securityExpert()).when(catalog).expert("security");
        return catalog;
    }

    static SemanticRouterDefinition guarded() {
        var definition = SemanticCatalogTest.definition();
        definition.guard = new SemanticGuard();
        definition.guard.expertId = "security";
        definition.guard.operation = "injection";
        definition.guard.parameters = Map.of("threshold", 0.7);
        return definition;
    }

    @Test
    void guardedArchiveIsDeterministicAndSharesPreclassificationRouteWithPreview() throws Exception {
        SemanticCatalogTest fixture = new SemanticCatalogTest();
        fixture.setup();
        fixture.catalog = withSecurity(fixture.catalog);
        fixture.generator.catalog = fixture.catalog;
        fixture.validator.catalog = fixture.catalog;
        var definition = guarded();
        assertThat(fixture.validator.validate(definition, false).errors).isEmpty();
        byte[] archive = fixture.generator.generate(definition, "r1", "support-r1");
        assertThat(fixture.generator.generate(definition, "r1", "support-r1")).isEqualTo(archive);
        var files = CatalogZipReader.readEntriesAsText(archive);
        assertThat(files.get("service/dependencies.txt")).contains("camel-wolf-defender", "camel-typesafe-ai");
        var main = new YAMLMapper().readTree(files.get(SemanticCatalogGenerator.MAIN));
        var preview = new YAMLMapper().readTree(files.get("service/preview.camel.yaml"));
        assertThat(main.get(0)).isEqualTo(preview.get(0));
        assertThat(main.get(1)).isEqualTo(preview.get(1));
        var steps = main.get(1).path("route").path("from").path("steps");
        assertThat(steps).hasSize(3);
        assertThat(steps.get(0)
                        .path("setProperty")
                        .path("expression")
                        .path("language")
                        .path("expression")
                        .asText())
                .isEqualTo("ref:guard");
        assertThat(steps.get(1)
                        .path("choice")
                        .path("when")
                        .get(0)
                        .path("simple")
                        .asText())
                .endsWith("== true");
        assertThat(steps.get(1).toString()).contains(SemanticCatalogGenerator.GUARD_REJECTION);
        assertThat(steps.get(2).toString()).contains("ref:department");
        assertThat(SemanticYamlValidator.validate(
                        files.get(SemanticCatalogGenerator.MAIN).getBytes(StandardCharsets.UTF_8)))
                .isEmpty();
        var snapshots = new ObjectMapper().readTree(files.get(SemanticCatalogGenerator.EXPERTS));
        assertThat(snapshots.path("guard").path("expert").path("id").asText()).isEqualTo("security");
        assertThat(snapshots.path("guard").path("parameters").path("threshold").doubleValue())
                .isEqualTo(0.7);
        definition.guard.rejectWhen = false;
        assertThat(fixture.generator.generate(definition, "r1", "support-r1")).isNotEqualTo(archive);
    }

    @Test
    void guardCapabilityAndParametersAreCheckedBeforePublication() {
        SemanticCatalogTest fixture = new SemanticCatalogTest();
        fixture.setup();
        fixture.validator.catalog = withSecurity(fixture.catalog);
        var definition = guarded();
        definition.guard.parameters = Map.of("threshold", 1.5);
        assertThat(fixture.validator.validate(definition, false).errors)
                .extracting(e -> e.field)
                .contains("guard.parameters");
        definition.guard.parameters = Map.of("instructions", "unsupported");
        assertThat(fixture.validator.validate(definition, false).valid).isFalse();
        definition.guard.parameters = Map.of("threshold", "{{env:SECRET}}");
        assertThat(fixture.validator.validate(definition, true).valid).isFalse();
        definition.guard.parameters = Map.of();
        definition.guard.operation = "choice";
        assertThat(fixture.validator.validate(definition, false).errors)
                .extracting(e -> e.field)
                .contains("guard.operation");
        definition = guarded();
        definition.expertId = "security";
        assertThat(fixture.validator.validate(definition, false).errors)
                .extracting(e -> e.field)
                .contains("expertId");
    }

    @Test
    void previewRejectsBeforeClassifierAndSupportsBothBooleanPolarities() throws Exception {
        for (boolean rejectWhen : List.of(true, false)) {
            AtomicInteger calls = new AtomicInteger();
            HttpServer server = server(
                    calls,
                    "{\"resultType\":\"boolean\",\"value\":" + rejectWhen
                            + ",\"diagnostics\":{\"probability\":0.8,\"credential\":\"secret\"}}");
            try {
                var client = SemanticPreviewClientTest.client(server);
                client.catalog = withSecurity(client.catalog);
                var definition = guarded();
                definition.guard.rejectWhen = rejectWhen;
                var result = client.evaluate(definition, "Invoice");
                assertThat(result.blocked).isTrue();
                assertThat(result.label).isNull();
                assertThat(result.noMatch).isFalse();
                assertThat(result.error).isNull();
                assertThat(result.guard.value).isEqualTo(rejectWhen);
                assertThat(result.guard.diagnostics).containsOnlyKeys("probability");
                assertThat(calls).hasValue(1);
            } finally {
                server.stop(0);
            }
        }
    }

    @Test
    void acceptedGuardClassifiesOnceAndRetainsVerdict() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        HttpServer server = server(calls, "{\"resultType\":\"boolean\",\"value\":false}");
        try {
            var client = SemanticPreviewClientTest.client(server);
            client.catalog = withSecurity(client.catalog);
            var result = client.evaluate(guarded(), "Invoice");
            assertThat(result.blocked).isFalse();
            assertThat(result.guard.value).isFalse();
            assertThat(result.label).isEqualTo("billing");
            assertThat(result.error).isNull();
            assertThat(calls).hasValue(2);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void malformedAndFailedGuardsDoNotClassify() throws Exception {
        for (String response : List.of(
                "{\"resultType\":\"boolean\",\"value\":\"false\"}",
                "{\"resultType\":\"choice\",\"value\":false}",
                "null",
                "provider secret")) {
            AtomicInteger calls = new AtomicInteger();
            HttpServer server = server(calls, response);
            try {
                var client = SemanticPreviewClientTest.client(server);
                client.catalog = withSecurity(client.catalog);
                var result = client.evaluate(guarded(), "Invoice");
                assertThat(result.blocked).isFalse();
                assertThat(result.guard).isNull();
                assertThat(result.label).isNull();
                assertThat(result.error)
                        .isEqualTo("Semantic guard evaluation failed")
                        .doesNotContain("secret");
                assertThat(calls).hasValue(1);
            } finally {
                server.stop(0);
            }
        }
    }

    @Test
    void guardAndClassifierShareOnePreviewDeadline() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        HttpServer server = server(calls, "{\"resultType\":\"boolean\",\"value\":false}", 650);
        try {
            var client = SemanticPreviewClientTest.client(server);
            client.catalog = withSecurity(client.catalog);
            var result = client.evaluate(guarded(), "Invoice");
            assertThat(result.guard).isNotNull();
            assertThat(result.label).isNull();
            assertThat(result.blocked).isFalse();
            assertThat(result.error).isEqualTo("Semantic evaluation failed");
            assertThat(calls).hasValue(2);
        } finally {
            server.stop(0);
        }
    }

    private static HttpServer server(AtomicInteger calls, String guardResponse) throws Exception {
        return server(calls, guardResponse, 0);
    }

    private static HttpServer server(AtomicInteger calls, String guardResponse, int delayMillis) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/preview", request -> {
            var payload = new ObjectMapper().readTree(request.getRequestBody());
            calls.incrementAndGet();
            try {
                Thread.sleep(delayMillis);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            String response = "injection".equals(payload.path("operation").asText())
                    ? guardResponse
                    : "{\"resultType\":\"choice\",\"value\":\"billing\"}";
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            request.sendResponseHeaders(200, bytes.length);
            request.getResponseBody().write(bytes);
            request.close();
        });
        server.start();
        return server;
    }
}
