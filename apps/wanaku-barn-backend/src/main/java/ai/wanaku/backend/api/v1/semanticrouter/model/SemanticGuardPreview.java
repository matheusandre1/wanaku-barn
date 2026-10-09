package ai.wanaku.backend.api.v1.semanticrouter.model;

import java.util.Map;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

/** Native Boolean guard verdict and available sanitized diagnostics. */
@Schema(name = "SemanticGuardPreview")
public class SemanticGuardPreview {
    public boolean value;
    public Map<String, Object> diagnostics;
}
