package ai.wanaku.backend.api.v1.semanticrouter;

import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.NotFoundException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import ai.wanaku.backend.api.v1.exceptions.InvalidPayloadException;
import ai.wanaku.backend.api.v1.semanticrouter.model.SemanticExpert;
import ai.wanaku.backend.api.v1.semanticrouter.model.SemanticExpertOperation;
import ai.wanaku.backend.core.persistence.api.DataStoreRepository;
import ai.wanaku.capabilities.sdk.api.types.DataStore;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.InputFormat;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;

/** Persisted administrator metadata for deployment-owned expert instances. */
@ApplicationScoped
public class SemanticExpertCatalog {
    public static final String TYPE = "semantic-expert";
    public static final String PREFIX = "semantic-expert-";
    static final String INITIALIZED = PREFIX + "initialized";

    @Inject
    DataStoreRepository repository;

    @Inject
    ObjectMapper mapper;

    @ConfigProperty(name = "wanaku.semantic.experts-file")
    Optional<String> expertsFile;

    @PostConstruct
    synchronized void init() {
        if (repository.findById(INITIALIZED) != null) return;
        try {
            List<SemanticExpert> seeds;
            if (expertsFile.isPresent()) {
                Path file = Path.of(expertsFile.get());
                if (Files.size(file) > 64 * 1024) throw new IOException("Expert catalog exceeds 64 KiB");
                seeds = mapper.readValue(Files.readString(file), new TypeReference<>() {});
            } else seeds = List.of(defaultExpert());
            HashSet<String> ids = new HashSet<>();
            HashSet<String> beans = new HashSet<>();
            for (SemanticExpert expert : seeds) {
                validate(expert);
                if (!ids.add(expert.id) || !beans.add(expert.bean))
                    throw new InvalidPayloadException("Expert IDs and beans must be unique");
            }
            for (SemanticExpert expert : seeds) repository.persistIfAbsent(record(expert));
            DataStore marker = new DataStore();
            marker.setId(INITIALIZED);
            marker.setName(INITIALIZED);
            marker.setData("true");
            marker.setLabels(Map.of("wanaku.type", "semantic-expert-initialization"));
            repository.persistIfAbsent(marker);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot initialize semantic expert catalog", e);
        }
    }

    /** Shares the catalog mutation monitor with draft saves and publication snapshots. */
    Object mutationLock() {
        return this;
    }

    /** Returns the deployment-compatible seed used by legacy catalogs. */
    static SemanticExpert defaultExpert() {
        SemanticExpert expert = new SemanticExpert();
        expert.id = "support";
        expert.name = "Support expert (deployment configured)";
        expert.bean = "supportExpert";
        expert.dependency = "org.apache.camel:camel-typesafe-ai:4.23.0-SNAPSHOT";
        legacyOperations(expert);
        return expert;
    }

    /** Lists current metadata, sorted by ID. */
    public List<SemanticExpert> list() {
        return repository.findByType(TYPE).stream()
                .map(this::decode)
                .sorted(Comparator.comparing(expert -> expert.id))
                .toList();
    }

    /** Gets one expert by its public identifier. */
    public SemanticExpert get(String id) {
        DataStore data = repository.findById(PREFIX + id);
        if (data == null
                || data.getLabels() == null
                || !TYPE.equals(data.getLabels().get("wanaku.type")))
            throw new NotFoundException("Semantic expert not found");
        return decode(data);
    }

    /** Creates metadata with a unique ID and Camel bean. */
    public synchronized SemanticExpert create(SemanticExpert expert) {
        validate(expert);
        if (list().stream().anyMatch(existing -> existing.id.equals(expert.id) || existing.bean.equals(expert.bean)))
            throw new SemanticResolutionConflictException("Expert ID and bean must be unique");
        repository.create(record(expert));
        return expert;
    }

    /** Replaces metadata while keeping its identifier. */
    public synchronized SemanticExpert update(String id, SemanticExpert expert) {
        get(id);
        validate(expert);
        if (!id.equals(expert.id)) throw new InvalidPayloadException("Expert identifier cannot change");
        if (list().stream().anyMatch(existing -> !existing.id.equals(id) && existing.bean.equals(expert.bean)))
            throw new SemanticResolutionConflictException("Expert bean must be unique");
        repository.update(PREFIX + id, record(expert), null);
        return expert;
    }

    /** Deletes metadata only when no saved draft references the expert. */
    public synchronized void remove(String id) {
        get(id);
        for (DataStore draft : repository.findByType(SemanticRouterBean.TYPE)) {
            try {
                JsonNode definition = mapper.readTree(draft.getData());
                if (id.equals(definition.path("expertId").asText())
                        || id.equals(definition.path("guard").path("expertId").asText()))
                    throw new SemanticResolutionConflictException("Expert is referenced by a router draft");
            } catch (IOException e) {
                throw new IllegalStateException("Cannot read stored semantic draft", e);
            }
        }
        repository.deleteById(PREFIX + id);
    }

    private SemanticExpert decode(DataStore data) {
        try {
            SemanticExpert expert = mapper.readValue(data.getData(), SemanticExpert.class);
            legacyOperations(expert);
            return expert;
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read stored semantic expert", e);
        }
    }

    private DataStore record(SemanticExpert expert) {
        try {
            DataStore data = new DataStore();
            data.setId(PREFIX + expert.id);
            data.setName(PREFIX + expert.id);
            data.setLabels(Map.of("wanaku.type", TYPE));
            data.setData(mapper.writeValueAsString(expert));
            return data;
        } catch (IOException e) {
            throw new IllegalStateException("Cannot encode semantic expert", e);
        }
    }

    static void legacyOperations(SemanticExpert expert) {
        if (expert.operations != null) return;
        SemanticExpertOperation choice = new SemanticExpertOperation();
        choice.name = "choice";
        choice.inputTypes = List.of("text");
        choice.resultType = "choice";
        choice.resultMeaning = "Selected criterion";
        choice.parameterSchema = Map.of(
                "type",
                "object",
                "properties",
                Map.of(
                        "instructions",
                        Map.of("type", "string", "minLength", 1),
                        "criteria",
                        Map.of("type", "object", "additionalProperties", Map.of("type", "string"))),
                "required",
                List.of("instructions", "criteria"),
                "additionalProperties",
                false);
        expert.operations = List.of(choice);
    }

    private void validate(SemanticExpert expert) {
        if (expert == null
                || expert.id == null
                || !expert.id.matches("[a-z][a-z0-9_-]{0,63}")
                || "initialized".equals(expert.id)
                || expert.name == null
                || expert.name.isBlank()
                || expert.name.length() > 120
                || expert.bean == null
                || !expert.bean.matches("[A-Za-z][A-Za-z0-9_]{0,63}")
                || expert.dependency == null
                || !expert.dependency.matches("[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+"))
            throw new InvalidPayloadException("Invalid expert identity or dependency");
        legacyOperations(expert);
        if (expert.operations.isEmpty() || expert.operations.size() > 32)
            throw new InvalidPayloadException("Expert must declare between 1 and 32 operations");
        HashSet<String> names = new HashSet<>();
        for (SemanticExpertOperation operation : expert.operations) {
            if (operation == null
                    || operation.name == null
                    || !operation.name.matches("[A-Za-z][A-Za-z0-9_-]{0,63}")
                    || !names.add(operation.name)
                    || operation.inputTypes == null
                    || operation.inputTypes.isEmpty()
                    || operation.inputTypes.size() > 16
                    || operation.inputTypes.stream().anyMatch(v -> v == null || v.isBlank() || v.length() > 64)
                    || operation.resultType == null
                    || operation.resultType.isBlank()
                    || operation.resultType.length() > 64
                    || operation.resultMeaning != null && operation.resultMeaning.length() > 512
                    || operation.parameterSchema == null)
                throw new InvalidPayloadException("Invalid expert operation metadata");
            JsonNode schema = mapper.valueToTree(operation.parameterSchema);
            if (schema.toString().length() > 16384
                    || !"object".equals(schema.path("type").asText())
                    || schema.findValue("$ref") != null
                    || schema.findValue("$dynamicRef") != null
                    || schema.findValue("$recursiveRef") != null
                    || schema.findValue("$schema") != null)
                throw new InvalidPayloadException(
                        "Operation schema must be a bounded object without references or external dialects");
            try {
                if (!SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_7)
                        .getSchema(SchemaLocation.of("classpath:/draft-07/schema"))
                        .validate(schema.toString(), InputFormat.JSON)
                        .isEmpty()) throw new InvalidPayloadException("Invalid operation parameter schema");
                SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_7)
                        .getSchema(schema.toString(), InputFormat.JSON);
            } catch (RuntimeException e) {
                throw new InvalidPayloadException("Invalid operation parameter schema");
            }
        }
    }

    /** Validates operation parameters against their administrator-declared schema. */
    public static List<String> validateParameters(SemanticExpertOperation operation, Map<String, Object> parameters) {
        try {
            ObjectMapper json = new ObjectMapper();
            var schema = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_7)
                    .getSchema(json.writeValueAsString(operation.parameterSchema), InputFormat.JSON);
            return schema.validate(json.writeValueAsString(parameters), InputFormat.JSON).stream()
                    .map(Object::toString)
                    .toList();
        } catch (IOException | RuntimeException e) {
            return List.of("Invalid operation parameters or schema");
        }
    }
}
