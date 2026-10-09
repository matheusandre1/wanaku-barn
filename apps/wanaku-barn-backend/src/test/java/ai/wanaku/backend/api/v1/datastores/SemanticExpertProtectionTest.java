package ai.wanaku.backend.api.v1.datastores;

import jakarta.enterprise.inject.Instance;

import java.util.List;
import java.util.Map;
import ai.wanaku.backend.core.persistence.api.DataStoreRepository;
import ai.wanaku.capabilities.sdk.api.exceptions.WanakuException;
import ai.wanaku.capabilities.sdk.api.types.DataStore;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SemanticExpertProtectionTest {
    @Test
    @SuppressWarnings("unchecked")
    void genericMutationsCannotChangeExpertsOrInitializationState() {
        DataStoreRepository repository = mock(DataStoreRepository.class);
        Instance<DataStoreRepository> instance = mock(Instance.class);
        when(instance.get()).thenReturn(repository);
        DataStoresBean bean = new DataStoresBean();
        bean.dataStoreRepositoryInstance = instance;
        bean.init();
        DataStore expert = new DataStore();
        expert.setId("semantic-expert-support");
        expert.setName("semantic-expert-support");
        expert.setLabels(Map.of("wanaku.type", "semantic-expert"));
        when(repository.findById(expert.getId())).thenReturn(expert);
        when(repository.findByName(expert.getName())).thenReturn(List.of(expert));
        when(repository.findAllFilterByLabelExpression(anyString())).thenReturn(List.of(expert));
        assertThrows(WanakuException.class, () -> bean.add(expert));
        assertThrows(WanakuException.class, () -> bean.update(expert));
        assertThrows(WanakuException.class, () -> bean.removeById(expert.getId()));
        assertThrows(WanakuException.class, () -> bean.remove(expert.getName()));
        assertThrows(WanakuException.class, () -> bean.removeIf("wanaku.type=semantic-expert"));
        DataStore marker = new DataStore();
        marker.setId("other-id");
        marker.setLabels(Map.of("wanaku.type", "semantic-expert-initialization"));
        assertThrows(WanakuException.class, () -> bean.add(marker));
        verify(repository, never()).deleteById(anyString());
    }
}
