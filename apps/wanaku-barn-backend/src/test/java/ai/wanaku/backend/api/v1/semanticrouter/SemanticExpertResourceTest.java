package ai.wanaku.backend.api.v1.semanticrouter;

import jakarta.inject.Inject;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import io.quarkus.test.junit.QuarkusTest;
import ai.wanaku.backend.api.v1.semanticrouter.model.SemanticExpert;
import ai.wanaku.backend.api.v1.semanticrouter.model.SemanticExpertOperation;
import ai.wanaku.backend.core.persistence.api.DataStoreRepository;
import ai.wanaku.capabilities.sdk.api.types.DataStore;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;

import org.junit.jupiter.api.Test;

/** Exercises the expert contract through REST against the actual persistence repository. */
@QuarkusTest
class SemanticExpertResourceTest {
    private static final String API = "/api/v1/semantic-routers/experts";

    @Inject
    DataStoreRepository repository;

    @Test
    void managesExpertMetadataAndPreventsReferencedDeletion() {
        String suffix = UUID.randomUUID().toString().replace("-", "");
        SemanticExpert expert = SemanticExpertCatalog.defaultExpert();
        expert.id = "rest_" + suffix;
        expert.bean = "restExpert" + suffix;
        expert.name = "REST expert";
        String duplicateId = "dup_" + suffix;
        String draftId = "expert-test-draft-" + suffix;
        try {
            given().contentType("application/json")
                    .body(expert)
                    .post(API)
                    .then()
                    .statusCode(200)
                    .body("data.id", equalTo(expert.id));
            given().get(API + "/" + expert.id).then().statusCode(200).body("data.bean", equalTo(expert.bean));
            given().get(API).then().statusCode(200).body("data.id", hasItem(expert.id));

            SemanticExpert duplicate = SemanticExpertCatalog.defaultExpert();
            duplicate.id = duplicateId;
            duplicate.bean = expert.bean;
            given().contentType("application/json")
                    .body(duplicate)
                    .post(API)
                    .then()
                    .statusCode(409);

            SemanticExpertOperation guard = new SemanticExpertOperation();
            guard.name = "safe";
            guard.inputTypes = List.of("text");
            guard.resultType = "boolean";
            guard.resultMeaning = "True indicates safe input";
            guard.parameterSchema = Map.of("type", "object", "additionalProperties", false);
            expert.operations = List.of(guard);
            expert.name = "Updated REST expert";
            given().contentType("application/json")
                    .body(expert)
                    .put(API + "/" + expert.id)
                    .then()
                    .statusCode(200)
                    .body("data.name", equalTo(expert.name))
                    .body("data.operations[0].name", equalTo("safe"));
            given().get(API + "/" + expert.id)
                    .then()
                    .statusCode(200)
                    .body("data.operations[0].resultType", equalTo("boolean"));

            guard.parameterSchema = Map.of(
                    "type",
                    "object",
                    "properties",
                    Map.of("unsafe", Map.of("$ref", "https://example.com/external-schema")));
            given().contentType("application/json")
                    .body(expert)
                    .put(API + "/" + expert.id)
                    .then()
                    .statusCode(422);
            given().get(API + "/" + expert.id)
                    .then()
                    .statusCode(200)
                    .body("data.operations[0].parameterSchema.additionalProperties", equalTo(false));

            DataStore draft = new DataStore();
            draft.setId(draftId);
            draft.setName(draftId);
            draft.setLabels(Map.of("wanaku.type", SemanticRouterBean.TYPE));
            draft.setData("{\"expertId\":\"" + expert.id + "\"}");
            repository.create(draft);
            given().delete(API + "/" + expert.id).then().statusCode(409);
            draft.setData("{\"guard\":{\"expertId\":\"" + expert.id + "\"}}");
            repository.update(draftId, draft, null);
            given().delete(API + "/" + expert.id).then().statusCode(409);
            repository.deleteById(draftId);

            given().delete(API + "/" + expert.id).then().statusCode(200);
            given().get(API + "/" + expert.id).then().statusCode(404);
            given().delete(API + "/" + expert.id).then().statusCode(404);
        } finally {
            repository.deleteById(draftId);
            repository.deleteById(SemanticExpertCatalog.PREFIX + expert.id);
            repository.deleteById(SemanticExpertCatalog.PREFIX + duplicateId);
        }
    }
}
