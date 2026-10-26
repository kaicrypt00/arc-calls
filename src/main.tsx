/*
 *  ███╗   ███╗ ██████╗    ██╗  ██╗
 *  ████╗ ████║██╔════╝    ██║ ██╔╝
 *  ██╔████╔██║██║         █████╔╝
 *  ██║╚██╔╝██║██║         ██╔═██╗
 *  ██║ ╚═╝ ██║╚██████╗    ██║  ██╗
 *  ╚═╝     ╚═╝ ╚═════╝    ╚═╝  ╚═╝
 *
 *  Arc Calls — Community Prediction Platform on Arc Mainnet
 *  Built with Arc Studio — https://studio.arc.io
 */

import './tracing'
import './console-capture'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'
import { BrowserRouter } from 'react-router-dom'
import { config } from './config'
import { ToastProvider } from './contexts/ToastContext'
import { SessionWalletProvider } from './contexts/SessionWalletContext'
import { DataPrefetchProvider } from './contexts/DataPrefetchContext'
import { ProfileProvider } from './contexts/ProfileContext'
import { SoundProvider } from './contexts/SoundContext'
import App from './App'
import './index.css'

// Arc RainbowKit theme — deep navy + Arc blue accent
const arcTheme = darkTheme({
  accentColor: '#5a8ab0',
  accentColorForeground: '#ffffff',
  borderRadius: 'medium',
  fontStack: 'system',
  overlayBlur: 'small',
})
arcTheme.colors.connectButtonBackground    = 'rgba(6,30,60,0.9)'
arcTheme.colors.connectButtonInnerBackground = 'rgba(6,42,81,0.8)'
arcTheme.colors.connectButtonText          = '#E4E8EC'
arcTheme.colors.connectButtonTextError     = '#f87171'
arcTheme.colors.modalBackground            = '#010d1f'
arcTheme.colors.modalBorder                = 'rgba(54,97,132,0.3)'
arcTheme.colors.profileForeground          = '#010d1f'
arcTheme.colors.selectedOptionBorder       = 'rgba(90,138,176,0.5)'
arcTheme.colors.menuItemBackground         = 'rgba(6,30,60,0.8)'

const queryClient = new QueryClient()

// Arc Studio watermark
const StudioLogo = () => (
  <svg width="14" height="16" viewBox="0 0 20 22" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0 21.5001C0.167192 16.2366 1.02308 11.3243 2.45378 7.50459C4.26573 2.66517 6.88869 0 9.83904 0C12.7894 0 15.412 2.66517 17.2243 7.50459C18.1669 10.0216 18.8605 13.0121 19.2713 16.2655C19.3081 16.556 19.3393 16.8513 19.3714 17.146C19.3819 17.1642 19.3881 17.1811 19.386 17.1949C19.386 17.1949 19.6275 18.7674 19.6788 21.5001H19.6515C19.2934 21.1937 15.0694 17.7329 8.06739 18.735C8.17304 17.4996 8.31833 16.2974 8.50603 15.1452C8.51562 15.0863 8.52671 15.0294 8.53649 14.9709C11.2828 14.8846 13.6866 15.2171 15.5299 15.6529C15.5231 15.6073 15.5173 15.5603 15.5103 15.5149C15.1314 13.0547 14.5724 10.8024 13.8517 8.87761C12.6732 5.73037 11.1354 3.77496 9.83904 3.77496C8.54269 3.77496 7.00493 5.73037 5.82649 8.87761C5.54123 9.63889 5.28154 10.4508 5.04866 11.3071C4.72126 12.507 4.44621 13.7934 4.22654 15.1451C3.90141 17.1412 3.69827 19.2821 3.62345 21.5001H0Z" fill="currentColor"/>
  </svg>
)

const StudioWatermark = () => (
  <a
    href="https://studio.arc.io/"
    target="_blank"
    rel="noopener noreferrer"
    style={{
      position: 'fixed', bottom: 16, right: 16,
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '8px 14px', fontSize: 12, fontWeight: 600,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#1B3158', textDecoration: 'none', cursor: 'pointer',
      background: 'rgba(172, 198, 233, 0.85)', backdropFilter: 'blur(12px)',
      borderRadius: 20, border: '1px solid rgba(255,255,255,0.4)', zIndex: 9999,
      boxShadow: '0 4px 20px rgba(27,49,88,0.15)',
    }}
  >
    <StudioLogo />
    Built with Arc Studio
  </a>
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={arcTheme}>
          <BrowserRouter>
            <ToastProvider>
              <SessionWalletProvider>
                <DataPrefetchProvider>
                  <ProfileProvider>
                    <SoundProvider>
                      <App />
                      <StudioWatermark />
                    </SoundProvider>
                  </ProfileProvider>
                </DataPrefetchProvider>
              </SessionWalletProvider>
            </ToastProvider>
          </BrowserRouter>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
