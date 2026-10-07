export function matchesShortcutKey(event: Pick<KeyboardEvent, 'key' | 'code'>, key: string): boolean {
  return event.key.toLowerCase() === key.toLowerCase() || event.code === `Key${key.toUpperCase()}`;
}

export function isEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]');
}
