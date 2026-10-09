package ai.wanaku.backend.api.v1.semanticrouter.model;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.Map;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

/** Administrator-declared capability of a deployment-configured Camel expert. */
@Schema(name = "SemanticExpertOperation")
public class SemanticExpertOperation {
    @NotBlank @Pattern(regexp = "[A-Za-z][A-Za-z0-9_-]{0,63}") @Schema(description = "Native operation name")
    public String name;

    @NotEmpty @Size(max = 16) @Schema(description = "Supported input kinds, for example text")
    public List<@NotBlank @Size(max = 64) String> inputTypes;

    @NotBlank @Size(max = 64) @Schema(description = "Native result kind, for example choice or boolean")
    public String resultType;

    @Size(max = 512) @Schema(description = "Human-readable meaning of the result")
    public String resultMeaning;

    @Schema(description = "Draft-07 JSON Schema for operation parameters, without external references")
    public Map<String, Object> parameterSchema;
}
