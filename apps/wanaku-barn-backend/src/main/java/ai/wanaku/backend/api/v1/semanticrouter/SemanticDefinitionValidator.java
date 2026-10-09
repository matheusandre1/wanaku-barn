package ai.wanaku.backend.api.v1.semanticrouter;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import ai.wanaku.backend.api.v1.semanticrouter.model.SemanticAction;
import ai.wanaku.backend.api.v1.semanticrouter.model.SemanticActionSelection;
import ai.wanaku.backend.api.v1.semanticrouter.model.SemanticExample;
import ai.wanaku.backend.api.v1.semanticrouter.model.SemanticExpertOperation;
import ai.wanaku.backend.api.v1.semanticrouter.model.SemanticFieldError;
import ai.wanaku.backend.api.v1.semanticrouter.model.SemanticRouterDefinition;
import ai.wanaku.backend.api.v1.semanticrouter.model.SemanticValidation;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.InputFormat;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;

/** Validates authoring data without dispatching routes or contacting an expert. */
@ApplicationScoped
public class SemanticDefinitionValidator {
    @Inject
    SemanticActionCatalog catalog;

    /** Returns all structural errors. Draft mode permits incomplete fields but bounds stored data. */
    public SemanticValidation validate(SemanticRouterDefinition definition, boolean draft) {
        List<SemanticFieldError> errors = new ArrayList<>();
        if (definition == null) {
            error(errors, "definition", "Definition is required");
            return result(errors);
        }
        validateIdentity(definition, errors, draft);
        validateActions(definition, errors, draft);
        validateExperts(definition, errors, draft);
        validateExamples(definition, errors, draft);
        return result(errors);
    }

    private void validateIdentity(SemanticRouterDefinition definition, List<SemanticFieldError> errors, boolean draft) {
        identifier(errors, "name", definition.name, 120, !draft);
        text(errors, "description", definition.description, 2048, !draft);
        text(errors, "instructions", definition.instructions, 4096, !draft);
        text(errors, "noMatchCriteria", definition.noMatchCriteria, 2048, !draft);
        identifier(errors, "toolName", definition.toolName, 64, !draft);
        if (!draft && !SemanticActionCatalog.PROFILE.equals(definition.profile))
            error(errors, "profile", "Select the message-to-string/v1 profile");
        if (!draft && !"message".equals(definition.semanticInput))
            error(errors, "semanticInput", "The supported semantic input is message");
        if (!draft && catalog.expert(definition.expertId) == null)
            error(errors, "expertId", "Select a configured expert");
    }

    private void validateExperts(SemanticRouterDefinition definition, List<SemanticFieldError> errors, boolean draft) {
        if (!draft && catalog.expert(definition.expertId) != null) {
            SemanticExpertOperation choice = operation(definition.expertId, "choice", "choice");
            if (choice == null) error(errors, "expertId", "Select a text-compatible choice expert");
            else if (definition.instructions != null
                    && definition.actions != null
                    && definition.noMatchCriteria != null
                    && definition.actions.stream()
                            .allMatch(action -> action != null && action.label != null && action.criteria != null)) {
                Map<String, Object> parameters = Map.of(
                        "instructions",
                        definition.instructions,
                        "criteria",
                        SemanticCatalogGenerator.criteria(definition));
                for (String issue : SemanticExpertCatalog.validateParameters(choice, parameters))
                    error(errors, "expertId", issue);
            }
        }
        if (definition.guard == null) return;
        var guard = definition.guard;
        text(errors, "guard.expertId", guard.expertId, 64, !draft);
        text(errors, "guard.operation", guard.operation, 64, !draft);
        if (guard.expertId != null && !guard.expertId.isEmpty() && !guard.expertId.matches("[a-z][a-z0-9_-]{0,63}"))
            error(errors, "guard.expertId", "Use an expert catalog identifier");
        if (guard.operation != null
                && !guard.operation.isEmpty()
                && !guard.operation.matches("[A-Za-z][A-Za-z0-9_-]{0,63}"))
            error(errors, "guard.operation", "Use a native operation name");
        Map<String, Object> parameters = guard.parameters == null ? Map.of() : guard.parameters;
        try {
            if (new ObjectMapper().writeValueAsBytes(parameters).length > 16384 || !literalParameters(parameters))
                error(
                        errors,
                        "guard.parameters",
                        "Use bounded literal parameters without Camel expressions or references");
        } catch (java.io.IOException e) {
            error(errors, "guard.parameters", "Invalid guard parameters");
        }
        if (draft) return;
        SemanticExpertOperation operation = operation(guard.expertId, guard.operation, "boolean");
        if (operation == null) error(errors, "guard.operation", "Select a text-compatible Boolean operation");
        else
            for (String issue : SemanticExpertCatalog.validateParameters(operation, parameters))
                error(errors, "guard.parameters", issue);
    }

    private SemanticExpertOperation operation(String expertId, String name, String resultType) {
        var expert = catalog.expert(expertId);
        if (expert == null || expert.operations == null) return null;
        return expert.operations.stream()
                .filter(operation -> operation != null
                        && java.util.Objects.equals(name, operation.name)
                        && resultType.equals(operation.resultType)
                        && operation.inputTypes != null
                        && operation.inputTypes.contains("text"))
                .findFirst()
                .orElse(null);
    }

    private static boolean literalParameters(Object value) {
        if (value instanceof String text)
            return !text.contains("{{")
                    && !text.contains("${")
                    && !text.startsWith("#bean:")
                    && !text.startsWith("#class:");
        if (value instanceof Map<?, ?> map)
            return map.entrySet().stream()
                    .allMatch(entry -> entry.getKey() instanceof String
                            && literalParameters(entry.getKey())
                            && literalParameters(entry.getValue()));
        if (value instanceof List<?> list)
            return list.stream().allMatch(SemanticDefinitionValidator::literalParameters);
        if (value instanceof Number number) return Double.isFinite(number.doubleValue());
        return value == null || value instanceof Boolean;
    }

    private void validateActions(SemanticRouterDefinition definition, List<SemanticFieldError> errors, boolean draft) {
        if (definition.actions == null) {
            if (!draft) error(errors, "actions", "Select at least two actions");
        } else if (definition.actions.size() > 16 || !draft && definition.actions.size() < 2)
            error(errors, "actions", "Select between two and sixteen actions");
        else {
            validateRevisions(definition.actions, errors);
            Set<String> labels = new HashSet<>();
            for (int i = 0; i < definition.actions.size(); i++)
                validateAction(definition.actions.get(i), "actions[" + i + "]", labels, errors, draft);
        }
    }

    private static void validateRevisions(List<SemanticActionSelection> actions, List<SemanticFieldError> errors) {
        Map<String, String> revisions = new LinkedHashMap<>();
        for (int i = 0; i < actions.size(); i++) {
            SemanticActionSelection selection = actions.get(i);
            if (selection == null || selection.actionId == null) continue;
            String revision = selection.sha256 == null ? "current" : selection.sha256;
            String previous = revisions.putIfAbsent(selection.actionId, revision);
            if (previous != null && !previous.equals(revision))
                error(
                        errors,
                        "actions[" + i + "].sha256",
                        "Select the same revision for repeated native Kamelet names");
        }
    }

    private void validateExamples(SemanticRouterDefinition definition, List<SemanticFieldError> errors, boolean draft) {
        if (definition.examples == null) return;
        if (definition.examples.size() > 30) {
            error(errors, "examples", "Store at most thirty examples");
            return;
        }
        for (int i = 0; i < definition.examples.size(); i++)
            validateExample(definition, definition.examples.get(i), "examples[" + i + "]", errors, draft);
    }

    private void validateExample(
            SemanticRouterDefinition definition,
            SemanticExample example,
            String path,
            List<SemanticFieldError> errors,
            boolean draft) {
        if (example == null) {
            error(errors, path, "Example is required");
            return;
        }
        text(errors, path + ".message", example.message, 8192, !draft);
        if (draft) return;
        if (Boolean.TRUE.equals(example.expectedBlocked)) {
            if (definition.guard == null)
                error(errors, path + ".expectedBlocked", "Enable a guard to expect rejection");
            return;
        }
        if (!"no_match".equals(example.expectedLabel)
                && (definition.actions == null
                        || definition.actions.stream()
                                .noneMatch(action -> action != null
                                        && java.util.Objects.equals(action.label, example.expectedLabel))))
            error(errors, path + ".expectedLabel", "Select an action label or no_match");
    }

    private void validateAction(
            SemanticActionSelection selection,
            String path,
            Set<String> labels,
            List<SemanticFieldError> errors,
            boolean draft) {
        if (selection == null) {
            error(errors, path, "Action is required");
            return;
        }
        text(errors, path + ".criteria", selection.criteria, 2048, !draft);
        if (selection.label != null
                && !selection.label.isEmpty()
                && (!selection.label.matches("[a-z][a-z0-9_]{0,47}")
                        || selection.label.equals("no_match")
                        || !labels.add(selection.label)))
            error(errors, path + ".label", "Use a unique action label; no_match is reserved");
        if (!draft && (selection.label == null || selection.label.isBlank()))
            error(errors, path + ".label", "Label is required");
        if (selection.sha256 != null && !selection.sha256.matches("[a-f0-9]{64}"))
            error(errors, path + ".sha256", "Use the exact lowercase SHA-256 revision pin");
        SemanticAction action = catalog.action(selection);
        if (action == null) {
            if (selection.configuration != null && !selection.configuration.isEmpty())
                error(errors, path + ".configuration", "Select an eligible action before entering configuration");
            if (!draft) error(errors, path + ".actionId", "Select an eligible curated action");
            return;
        }
        validateConfiguration(selection, action, path, errors, draft);
    }

    @SuppressWarnings("unchecked")
    private void validateConfiguration(
            SemanticActionSelection selection,
            SemanticAction action,
            String path,
            List<SemanticFieldError> errors,
            boolean draft) {
        Map<String, Object> properties =
                (Map<String, Object>) action.configurationSchema.getOrDefault("properties", Map.of());
        Map<String, Object> values = new LinkedHashMap<>();
        for (Map.Entry<String, Object> property : properties.entrySet()) {
            Object fallback = ((Map<String, Object>) property.getValue()).get("default");
            if (fallback != null) values.put(property.getKey(), fallback);
        }
        if (selection.configuration != null) {
            if (selection.configuration.size() > 64) {
                error(errors, path + ".configuration", "Store at most sixty-four configuration values");
                return;
            }
            for (Map.Entry<String, String> value : selection.configuration.entrySet()) {
                String field = path + ".configuration." + value.getKey();
                if (!properties.containsKey(value.getKey())) {
                    error(errors, field, "Unknown action configuration");
                    continue;
                }
                Map<String, Object> schema = (Map<String, Object>) properties.get(value.getKey());
                String configured = value.getValue();
                if (configured == null || configured.length() > 4096) {
                    error(errors, field, "Configuration value must not exceed 4096 characters");
                    continue;
                }
                if (Boolean.TRUE.equals(schema.get("x-secret-reference"))) {
                    if (!configured.matches("env:[A-Z_][A-Z0-9_]{0,127}"))
                        error(errors, field, "Use an environment reference such as env:SUPPORT_TOKEN");
                } else if (configured.contains("{{")
                        || configured.contains("${")
                        || configured.contains("}}")
                        || configured.startsWith("#"))
                    error(errors, field, "Expressions and property placeholders are not accepted");
                try {
                    values.put(
                            value.getKey(),
                            switch (String.valueOf(schema.get("type"))) {
                                case "boolean" -> {
                                    if (!configured.equals("true") && !configured.equals("false"))
                                        throw new IllegalArgumentException();
                                    yield Boolean.valueOf(configured);
                                }
                                case "integer" -> Long.valueOf(configured);
                                case "number" -> new java.math.BigDecimal(configured);
                                default -> configured;
                            });
                } catch (IllegalArgumentException e) {
                    error(errors, field, "Value does not match its native Kamelet type");
                }
            }
        }
        if (draft) return;
        try {
            ObjectMapper mapper = new ObjectMapper();
            Map<String, Object> schema = new LinkedHashMap<>(action.configurationSchema);
            schema.put("additionalProperties", false);
            for (com.networknt.schema.Error issue : SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_7)
                    .getSchema(mapper.writeValueAsString(schema), InputFormat.JSON)
                    .validate(mapper.writeValueAsString(values), InputFormat.JSON)) {
                error(errors, path + ".configuration", issue.getMessage());
            }
        } catch (java.io.IOException e) {
            throw new IllegalStateException("Cannot validate native Kamelet configuration", e);
        }
    }

    private static void identifier(
            List<SemanticFieldError> errors, String field, String value, int max, boolean required) {
        text(errors, field, value, max, required);
        if (value != null && !value.isEmpty() && !value.matches("[A-Za-z][A-Za-z0-9_-]*"))
            error(
                    errors,
                    field,
                    "Start with a letter and use only letters, digits, hyphens, or underscores; no spaces");
    }

    private static void text(List<SemanticFieldError> errors, String field, String value, int max, boolean required) {
        if (required && (value == null || value.isBlank())) error(errors, field, "Value is required");
        if (value != null && value.length() > max) error(errors, field, "Value must not exceed " + max + " characters");
    }

    private static void error(List<SemanticFieldError> errors, String field, String message) {
        SemanticFieldError e = new SemanticFieldError();
        e.field = field;
        e.message = message;
        errors.add(e);
    }

    private static SemanticValidation result(List<SemanticFieldError> errors) {
        SemanticValidation result = new SemanticValidation();
        result.valid = errors.isEmpty();
        result.errors = errors;
        return result;
    }
}
