import type { FC } from 'react'
import { AppShell as MantineAppShell, Box, Divider, Stack } from '@pikku/mantine/core'
import { Outlet } from '@tanstack/react-router'
import { m } from '@/i18n/messages'
import { useLocale } from '@/i18n/config'
import { Wordmark } from './Wordmark'
import { MobileTabBar } from './layout/MobileTabBar'
import { NavList, useNavItems } from './layout/nav'
import { ShellSettings } from './layout/ShellSettings'
import { TAB_BAR_FOOT } from './layout/mobileLayout'

/**
 * diffui's shell: a quiet sidebar on desktop, a foot tab bar on a phone.
 *
 * Deliberately plain. The screens diffui exists for are other apps' screenshots,
 * and chrome that competes with them makes a difference harder to see
 * (knowledge/decisions/design/neutral-because-the-images-are-the-interface.md).
 * The nav is two destinations, so the tab bar fits a thumb without a drawer.
 */
export const AppShell: FC = () => {
  useLocale()
  const navItems = useNavItems()

  return (
    <MantineAppShell
      navbar={{ width: 236, breakpoint: 'sm', collapsed: { mobile: true } }}
      // `xl` on a 390px phone spends 64 of 390 points on gutters.
      padding={{ base: 'md', sm: 'xl' }}
    >
      <MantineAppShell.Navbar p="md">
        <Stack h="100%" gap={4}>
          <Box px="xs" py="sm">
            <Wordmark name={m.app__name()} size={26} />
          </Box>

          <Box mt="xs">
            <NavList items={navItems} />
          </Box>

          <Box mt="auto" pt="xs">
            <Divider mb="xs" />
            <ShellSettings />
          </Box>
        </Stack>
      </MantineAppShell.Navbar>

      {/* Flex column so a full-height page can fill the region with `flex: 1`. */}
      <MantineAppShell.Main style={{ display: 'flex', flexDirection: 'column' }}>
        <Outlet />

        {/* Clears the foot bar. A spacer rather than padding on Main, so it can be
            hidden above `sm` instead of leaving dead space on desktop. */}
        <Box hiddenFrom="sm" style={{ flex: 'none', height: TAB_BAR_FOOT }} />

        <MobileTabBar items={navItems} />
      </MantineAppShell.Main>
    </MantineAppShell>
  )
}
