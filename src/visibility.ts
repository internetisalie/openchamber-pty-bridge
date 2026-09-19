export const observePanelVisibility = (root: HTMLElement, onChange: (visible: boolean) => void): (() => void) => {
  let previous: boolean | null = null;
  const report = (): void => {
    const visible = document.visibilityState !== 'hidden' && root.clientWidth > 0 && root.clientHeight > 0;
    if (visible === previous) return;
    previous = visible;
    onChange(visible);
  };
  const resize = new ResizeObserver(report);
  resize.observe(root);
  document.addEventListener('visibilitychange', report);
  window.addEventListener('pageshow', report);
  report();
  return () => {
    resize.disconnect();
    document.removeEventListener('visibilitychange', report);
    window.removeEventListener('pageshow', report);
  };
};
