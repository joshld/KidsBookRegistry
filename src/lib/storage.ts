/**
 * @deprecated Use registryService via RegistryContext. Kept for compatibility.
 */
import { registryService } from './storage/registryService';

export function loadState() {
  return registryService.getAppState();
}

export function saveState(state: Parameters<typeof registryService.scheduleSave>[0]) {
  registryService.scheduleSave(state);
}
