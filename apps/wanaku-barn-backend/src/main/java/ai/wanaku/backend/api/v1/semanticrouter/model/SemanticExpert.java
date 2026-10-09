package ai.wanaku.backend.api.v1.semanticrouter.model;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

/** Configured native Camel expert identifier API contract. */
@Schema(name = "SemanticExpert")
public class SemanticExpert {
    @Schema(description = "Configured expert catalog identifier")
    @NotBlank @Pattern(regexp = "[a-z][a-z0-9_-]{0,63}") public String id;

    @Schema(description = "Configured expert display name")
    @NotBlank @Size(max = 120) public String name;

    @Schema(description = "Named Camel expert instance configured externally by the deployment")
    @NotBlank @Pattern(regexp = "[A-Za-z][A-Za-z0-9_]{0,63}") public String bean;

    @Schema(description = "Maven group:artifact:version implementation dependency")
    @NotBlank @Pattern(regexp = "[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+") public String dependency;

    @Schema(description = "Whether this contract exposes confidence controls")
    public boolean supportsConfidence;

    @Valid @Size(max = 32) @Schema(description = "Administrator declared native operations; omitted legacy entries expose choice")
    public List<SemanticExpertOperation> operations;
}
