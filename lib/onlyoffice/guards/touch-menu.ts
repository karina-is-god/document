/**
 * Touch toolbar menus vs. the on-screen keyboard (ddalkak.app).
 *
 * On phones, with the keyboard open (the caret is in the editor's hidden input),
 * tapping a toolbar menu such as the "more" (…) button blurs the input, the
 * keyboard starts to close, the window height changes, and the toolbar's
 * onResize handler calls hideMoreBtns() -- so the panel opens and immediately
 * closes. The editor then puts the caret back into its input, the keyboard
 * reopens, and the cycle repeats. In-app browsers (e.g. the NAVER app) make
 * this worse because they ignore `interactive-widget=overlays-content`.
 *
 * On coarse-pointer devices only:
 *  1. A touch on the toolbar first moves focus out of the text input, so the
 *     keyboard is already closing before the menu opens.
 *  2. Shortly after step 1, the editor may not move focus back into a text
 *     input on its own (that is what brought the keyboard back).
 *  3. While a toolbar menu / "more" panel is open (or step 2 holds), a resize (keyboard opening/closing) does not make the
 *     toolbar hide its "more" panel or close an open menu.
 */
type FocusFn = (this: HTMLElement, options?: FocusOptions) => void;

const TOOLBAR = '#toolbar, .toolbar, .more-container, .dropdown-menu, .btn-toolbar, .ribtab, .tabs';
const HOLD_MS = 1500;

export function installTouchMenuGuard(win: Window): boolean {
  const w = win as Window & typeof globalThis & { __ooTouchMenuGuarded?: boolean };
  if (w.__ooTouchMenuGuarded) return true;
  const doc = win.document;
  if (!doc || !doc.body) return false;
  w.__ooTouchMenuGuarded = true;
  if (!win.matchMedia || !win.matchMedia('(pointer: coarse)').matches) return true;

  const isText = (el: Element | null): el is HTMLElement => {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color'].includes((el as HTMLInputElement).type);
    return (el as HTMLElement).isContentEditable === true;
  };
  const inToolbar = (el: Element | null) => !!el && typeof el.closest === 'function' && !!el.closest(TOOLBAR);
  const visible = (el: Element) => (el as HTMLElement).offsetParent !== null;
  const menuOpen = () =>
    !!doc.querySelector('.btn-group.open, .open > .dropdown-menu, .dropdown-menu.show') ||
    Array.from(doc.querySelectorAll('.more-container')).some(visible);

  let holdUntil = 0;
  let moreToolbar: { hideMoreBtns?: () => void } | undefined;
  const holding = () => Date.now() < holdUntil || menuOpen();

  // 1. 툴바를 누르면 먼저 입력 칸에서 초점을 빼서 키패드를 닫음
  doc.addEventListener(
    'pointerdown',
    (e) => {
      const target = e.target as Element | null;
      if (!inToolbar(target)) {
        // 문서 쪽을 누르면 열려 있던 "더보기"를 닫음 (아래 3번 때문에 키패드가 열려도 안 닫히므로)
        if (Array.from(doc.querySelectorAll('.more-container')).some(visible)) moreToolbar?.hideMoreBtns?.();
        return;
      }
      if (isText(target)) return; // 글꼴 이름 칸처럼 직접 입력하는 칸은 그대로
      const active = doc.activeElement;
      if (isText(active) && !inToolbar(active)) {
        active.blur();
        holdUntil = Date.now() + HOLD_MS;
      }
    },
    true,
  );

  // 2. 툴바를 누른 직후 잠깐은 편집기가 스스로 입력 칸에 초점을 다시 넣지 않게 함 (키패드 재등장 방지)
  const proto = w.HTMLElement.prototype as HTMLElement & { focus: FocusFn };
  const origFocus = proto.focus;
  proto.focus = function (this: HTMLElement, options?: FocusOptions) {
    if (isText(this) && !inToolbar(this) && Date.now() < holdUntil) return;
    return origFocus.call(this, options);
  };

  // 3. 키패드가 열리고 닫히며 창 크기가 바뀌어도, 메뉴가 열려 있는 동안에는 툴바가 "더보기"와 메뉴를 닫지 않게 함
  const fromResize = () => (w as unknown as { event?: Event }).event?.type === 'resize';
  const patchTimer = win.setInterval(() => {
    const ui = (w as unknown as { Common?: { UI?: { Menu?: { prototype: Record<string, unknown> } } } }).Common?.UI;
    const menuProto = ui?.Menu?.prototype as (Record<string, unknown> & { __ddkPatched?: boolean }) | undefined;
    if (menuProto && typeof menuProto.hide === 'function' && !menuProto.__ddkPatched) {
      const origHide = menuProto.hide as (...a: unknown[]) => unknown;
      menuProto.hide = function (this: unknown, ...args: unknown[]) {
        if (fromResize() && holding()) return undefined;
        return origHide.apply(this, args);
      };
      menuProto.__ddkPatched = true;
    }
    const app = (w as unknown as Record<string, { getController?: (n: string) => { toolbar?: Record<string, unknown> } | undefined } | undefined>);
    const ctrl = (app.DE || app.PE || app.SSE || app.PDFE || app.VE)?.getController?.('Toolbar');
    const tb = ctrl?.toolbar as (Record<string, unknown> & { __ddkPatched?: boolean }) | undefined;
    if (tb && typeof tb.hideMoreBtns === 'function' && !tb.__ddkPatched) {
      const origHideMore = tb.hideMoreBtns as (...a: unknown[]) => unknown;
      tb.hideMoreBtns = function (this: unknown, ...args: unknown[]) {
        if (fromResize() && holding()) return undefined;
        return origHideMore.apply(this, args);
      };
      tb.__ddkPatched = true;
      moreToolbar = tb as { hideMoreBtns?: () => void };
    }
    if (menuProto?.__ddkPatched && tb?.__ddkPatched) win.clearInterval(patchTimer);
  }, 500);

  console.log('[OO] touch menu guard installed (keyboard closes before toolbar menus open)');
  return true;
}
