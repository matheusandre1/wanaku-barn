package ai.wanaku.backend.api.v1.semanticrouter;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import ai.wanaku.backend.api.v1.exceptions.InvalidPayloadException;
import ai.wanaku.backend.core.persistence.api.DataStoreRepository;
import ai.wanaku.capabilities.sdk.api.types.DataStore;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SemanticExpertCatalogTest {
    private final Map<String, DataStore> entries = new LinkedHashMap<>();
    private SemanticExpertCatalog catalog;

    @BeforeEach
    void setup() {
        catalog = new SemanticExpertCatalog();
        catalog.mapper = new ObjectMapper();
        catalog.expertsFile = Optional.empty();
        catalog.repository = mock(DataStoreRepository.class);
        when(catalog.repository.findById(anyString())).thenAnswer(call -> entries.get(call.getArgument(0)));
        when(catalog.repository.findByType(anyString())).thenAnswer(call -> entries.values().stream()
                .filter(data -> call.getArgument(0).equals(data.getLabels().get("wanaku.type")))
                .toList());
        when(catalog.repository.persistIfAbsent(any())).thenAnswer(call -> {
            DataStore data = call.getArgument(0);
            return entries.putIfAbsent(data.getId(), data);
        });
        when(catalog.repository.create(any())).thenAnswer(call -> {
            DataStore data = call.getArgument(0);
            entries.put(data.getId(), data);
            return data;
        });
        when(catalog.repository.update(anyString(), any(), isNull())).thenAnswer(call -> {
            DataStore data = call.getArgument(1);
            entries.put(data.getId(), data);
            return data;
        });
        when(catalog.repository.deleteById(anyString()))
                .thenAnswer(call -> entries.remove(call.getArgument(0)) != null);
        catalog.init();
    }

    @Test
    void initializesOnceAndDeletionSurvivesRestart() {
        assertEquals("choice", catalog.get("support").operations.getFirst().name);
        catalog.remove("support");
        catalog.init();
        assertTrue(catalog.list().isEmpty());
    }

    @Test
    void createsUpdatesAndRejectsDuplicateBean() {
        var expert = SemanticExpertCatalog.defaultExpert();
        expert.id = "other";
        assertThrows(SemanticResolutionConflictException.class, () -> catalog.create(expert));
        expert.bean = "otherExpert";
        catalog.create(expert);
        expert.name = "Updated";
        catalog.update("other", expert);
        assertEquals("Updated", catalog.get("other").name);
    }

    @Test
    void refusesClassifierAndGuardReferences() {
        DataStore draft = new DataStore();
        draft.setId("draft");
        draft.setLabels(Map.of("wanaku.type", SemanticRouterBean.TYPE));
        draft.setData("{\"guard\":{\"expertId\":\"support\"}}");
        entries.put("draft", draft);
        assertThrows(SemanticResolutionConflictException.class, () -> catalog.remove("support"));
        draft.setData("{\"expertId\":\"support\"}");
        assertThrows(SemanticResolutionConflictException.class, () -> catalog.remove("support"));
    }

    @Test
    void rejectsRemoteSchemasAndInvalidParameters() {
        var expert = SemanticExpertCatalog.defaultExpert();
        expert.operations.getFirst().parameterSchema =
                Map.of("type", "object", "properties", Map.of("value", Map.of("$ref", "https://example.com/schema")));
        assertThrows(InvalidPayloadException.class, () -> catalog.update("support", expert));
        var choice = SemanticExpertCatalog.defaultExpert().operations.getFirst();
        assertFalse(SemanticExpertCatalog.validateParameters(choice, Map.of()).isEmpty());
        assertTrue(SemanticExpertCatalog.validateParameters(
                        choice, Map.of("instructions", "Classify", "criteria", Map.of("help", "Help requests")))
                .isEmpty());
    }

    @Test
    void incompleteInitializationDoesNotOverwriteExistingMetadata() {
        var expert = catalog.get("support");
        expert.name = "Administrator edited seed";
        catalog.update("support", expert);
        entries.remove(SemanticExpertCatalog.INITIALIZED);
        catalog.init();
        assertEquals("Administrator edited seed", catalog.get("support").name);
        assertTrue(entries.containsKey(SemanticExpertCatalog.INITIALIZED));
    }

    @Test
    void invalidSeedFileDoesNotMarkInitializationComplete(
            @org.junit.jupiter.api.io.TempDir java.nio.file.Path directory) throws java.io.IOException {
        entries.clear();
        var expert = SemanticExpertCatalog.defaultExpert();
        expert.operations.getFirst().parameterSchema = Map.of("type", "object", "$ref", "https://example.com/schema");
        java.nio.file.Path file = directory.resolve("experts.json");
        java.nio.file.Files.writeString(file, catalog.mapper.writeValueAsString(java.util.List.of(expert)));
        catalog.expertsFile = Optional.of(file.toString());
        assertThrows(InvalidPayloadException.class, catalog::init);
        assertTrue(entries.isEmpty());
        catalog.expertsFile = Optional.empty();
        catalog.init();
        assertEquals("support", catalog.get("support").id);
        assertTrue(entries.containsKey(SemanticExpertCatalog.INITIALIZED));
    }
}
