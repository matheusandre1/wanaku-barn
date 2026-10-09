package ai.wanaku.backend.api.v1.semanticrouter.model;

import org.eclipse.microprofile.openapi.annotations.media.Schema;

/** Saved classification example API contract. */
@Schema(name = "SemanticExample")
public class SemanticExample {
    @Schema(description = "Classification example input")
    public String message;

    @Schema(description = "Expected action label or no_match")
    public String expectedLabel;

    @Schema(description = "Expect guard rejection instead of classification; absent means false", nullable = true)
    public Boolean expectedBlocked;
}
