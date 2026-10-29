/**
 * src/components/LayoutContext.tsx
 * Shares the drawer's layout mode (compact side panel vs. expanded full-screen workspace)
 * with nested components so they can adapt their spacing and sizing.
 */

import { createContext, useContext } from 'react';

export interface DrawerLayout {
  expanded: boolean;
}

export const DrawerLayoutContext = createContext<DrawerLayout>({ expanded: false });

export const useDrawerLayout = (): DrawerLayout => useContext(DrawerLayoutContext);
