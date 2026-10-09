package ai.wanaku.backend.api.v1.semanticrouter.model;

import java.util.Map;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/** Optional text evaluation that rejects a request before classification. */
@Schema(name = "SemanticGuard")
public class SemanticGuard {
    public String expertId;
    public String operation;
    public Map<String, Object> parameters = Map.of();

    @Schema(description = "Boolean verdict that rejects the request")
    @JsonSetter(nulls = Nulls.FAIL)
    public boolean rejectWhen = true;
}
