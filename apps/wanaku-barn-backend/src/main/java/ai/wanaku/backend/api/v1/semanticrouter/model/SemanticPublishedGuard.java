package ai.wanaku.backend.api.v1.semanticrouter.model;

import java.util.Map;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

/** Guard configuration and expert snapshot captured in an immutable publication. */
@Schema(name = "SemanticPublishedGuard")
public class SemanticPublishedGuard {
    public SemanticExpert expert;
    public String operation;
    public Map<String, Object> parameters;
    public boolean rejectWhen;
}
