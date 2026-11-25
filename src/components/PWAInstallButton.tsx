import React, {useState} from 'react';
import {Download, Share, X} from 'lucide-react';
import {usePWAInstall} from '../lib/usePWA';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'full';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({variant = 'compact'}) => {
  const {isInstallable, isInstalled, isIOS, install} = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className={
          variant === 'full'
            ? 'inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-lg bg-[#1E3A5F] text-white text-sm font-medium hover:bg-[#172D4B] dark:bg-[#7BA3D1] dark:text-[#141210] dark:hover:bg-[#93B5DC] transition-colors whitespace-nowrap shrink-0'
            : 'inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-medium text-[#1C1917] dark:text-[#F3EFE8] hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors whitespace-nowrap shrink-0'
        }
      >
        <Download className="w-4 h-4" />
        <span>Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={
            variant === 'full'
              ? 'inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-lg border border-stone-300 dark:border-stone-700 text-sm font-medium text-[#1C1917] dark:text-[#F3EFE8] hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors whitespace-nowrap shrink-0'
              : 'inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-medium text-[#1C1917] dark:text-[#F3EFE8] hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors whitespace-nowrap shrink-0'
          }
        >
          <Share className="w-3.5 h-3.5" />
          <span>Add to Home Screen</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="ios-install-title"
              className="w-full max-w-sm rounded-2xl bg-[#FBF9F5] dark:bg-[#1D1A17] border border-stone-200 dark:border-stone-800 p-6 shadow-xl"
            >
              <div className="flex items-start justify-between gap-4">
                <h3 id="ios-install-title" className="font-display text-xl font-semibold text-[#1C1917] dark:text-[#F3EFE8]">
                  Install Folio on iPhone
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Close installation guide"
                  className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <ol className="mt-4 space-y-3 text-sm text-stone-700 dark:text-stone-300 leading-relaxed">
                <li>1. Tap the <strong>Share</strong> icon in your Safari toolbar.</li>
                <li>2. Scroll down and select <strong>Add to Home Screen</strong>.</li>
                <li>3. Tap <strong>Add</strong> to open Folio like a native reader app.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-6 w-full min-h-[44px] rounded-lg bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] text-sm font-medium"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
