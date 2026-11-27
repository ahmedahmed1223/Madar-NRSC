import { Trash2 } from 'lucide-react';
import { TRASH_SECTIONS } from '../../shared/trash';
import { RbacService } from '../../services/rbacService';
import type { User } from '../../types';

const listingScreens = new Set(Object.values(TRASH_SECTIONS).map(section => section.screen));

export function SectionTrashLink({ screen, user, onOpen }: { screen: string; user: User; onOpen: (path: string) => void }) {
  if (!listingScreens.has(screen)) return null;
  const collection = RbacService.availableTrashCollections(user).find(key => TRASH_SECTIONS[key].screen === screen);
  if (!collection) return null;
  const path = '/trash/' + collection;
  return (
    <div className="mb-2 flex justify-end">
      <a href={path} onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpen(path);
      }} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-600">
        <Trash2 className="size-4" aria-hidden="true" /> محذوفات {TRASH_SECTIONS[collection].label}
      </a>
    </div>
  );
}
