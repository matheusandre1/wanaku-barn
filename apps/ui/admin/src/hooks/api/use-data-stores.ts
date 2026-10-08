import {useCallback} from "react";
import {
  deleteApiV1DataStoreId,
  getApiV1DataStore,
  getApiV1DataStoreId,
  postApiV1DataStore,
  putApiV1DataStore
} from "../../api/wanaku-router-api";
import type {
  DataStore,
  GetApiV1DataStoreParams,
} from "../../models";

/**
 * Custom hook for DataStore API operations
 */
export const useDataStores = () => {
  const getDataStore = useCallback(
    (id: string, options?: RequestInit) => getApiV1DataStoreId(id, options),
    []
  );
  const listDataStores = useCallback(
    (params?: GetApiV1DataStoreParams, options?: RequestInit) => {
      return getApiV1DataStore(params, options);
    },
    []
  );

  const addDataStore = useCallback(
    (dataStore: DataStore, options?: RequestInit) => {
      return postApiV1DataStore(dataStore, options);
    },
    []
  );

  const updateDataStore = useCallback(
    (dataStore: DataStore, options?: RequestInit) => {
      return putApiV1DataStore(dataStore, options);
    },
    []
  );

  const deleteDataStore = useCallback(
    (id: string, options?: RequestInit) => {
      return deleteApiV1DataStoreId(id, options);
    },
    []
  );

  return {
    getDataStore,
    listDataStores,
    addDataStore,
    updateDataStore,
    deleteDataStore,
  };
};
