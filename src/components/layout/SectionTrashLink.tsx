import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { isTrashScreen, TRASH_SCREEN_LABELS, TRASH_SECTIONS } from '../../shared/trash';
import { RbacService } from '../../services/rbacService';
import type { User } from '../../types';

export function TrashLink({ path, onOpen, className, children }: {
  path: string; onOpen: (path: string) => void; className: string; children: ReactNode;
}) {
  return (
    <a href={path} onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onOpen(path);
    }} className={className}>{children}</a>
  );
}

export function SectionTrashLink({ screen, user, onOpen }: { screen: string; user: User; onOpen: (path: string) => void }) {
  if (!isTrashScreen(screen)) return null;
  if (!RbacService.availableTrashCollections(user).some(key => TRASH_SECTIONS[key].screen === screen)) return null;
  return (
    <div className="mb-2 flex justify-end">
      <TrashLink path={'/trash/' + screen} onOpen={onOpen} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-600">
        <Trash2 className="size-4" aria-hidden="true" /> محذوفات {TRASH_SCREEN_LABELS[screen]}
      </TrashLink>
    </div>
  );
}
