import { apiService } from '../api';
import type { DocContext } from './builders';

/** The organisation name and the signed-in user, stamped on every exported document. */
export function docContext(): DocContext {
  let user: DocContext['user'] = null;
  try {
    user = apiService.getCurrentUser();
  } catch {
    user = null;
  }
  return { organization: apiService.getSettings()?.organizationName || '', user };
}
