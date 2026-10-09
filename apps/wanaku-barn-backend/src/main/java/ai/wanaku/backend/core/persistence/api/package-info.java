/**
 * Persistence layer API for the Wanaku system.
 * <p>
 * This package defines repository interfaces for data access and persistence
 * operations within Wanaku. The repositories provide CRUD operations and
 * query capabilities for managing data stores.
 * <p>
 * The persistence layer is designed to be implementation-agnostic, with concrete
 * implementations provided in the Infinispan persistence package.
 * <p>
 * Key repository interfaces include:
 * <ul>
 *   <li>{@link ai.wanaku.backend.core.persistence.api.WanakuRepository} - Base repository interface</li>
 *   <li>{@link ai.wanaku.backend.core.persistence.api.DataStoreRepository} - Data store persistence</li>
 * </ul>
 *
 * @see ai.wanaku.capabilities.sdk.api.types
 */
package ai.wanaku.backend.core.persistence.api;
