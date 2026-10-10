// @perch/reader — the reading app shared by the browser extension and the web
// reader. Hosts render <ReaderApp backend={…} /> inside their own router.

export { ReaderApp, type ReaderAppProps } from './App';
export * from './backend';

export { Button } from './components/Button';
export { Dialog } from './components/Dialog';
export { Favicon } from './components/Favicon';
export { IconButton } from './components/IconButton';
export { PerchLogo, PerchMark } from './components/PerchMark';
export { Spinner } from './components/Spinner';
export * from './components/icons';
export { Row, Section, Segmented, Toggle } from './pages/settings-ui';
export { ToastProvider, useToast } from './reader/Toasts';

export { useSettings } from './hooks/useSettings';
export { useNotes } from './hooks/useNotes';
export { useApplyTheme, useEffectiveMode } from './hooks/useTheme';
export { sanitizeHtml, type SanitizeOptions } from './lib/sanitize';
export { downloadText, pickFile, pickTextFile } from './lib/download';
