import React, {useState} from 'react';

interface BookCoverProps {
  title: string;
  author: string;
  coverUrl: string | null;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const CLOTH_PALETTES = [
  {bg: 'bg-[#1E3A5F]', text: 'text-[#F6F1E7]', spine: 'bg-[#152943]', border: 'border-[#2D4F7A]'},
  {bg: 'bg-[#2E4239]', text: 'text-[#F5F2EB]', spine: 'bg-[#213029]', border: 'border-[#3D574B]'},
  {bg: 'bg-[#4B3832]', text: 'text-[#F8F4EE]', spine: 'bg-[#362823]', border: 'border-[#614941]'},
  {bg: 'bg-[#373B47]', text: 'text-[#F4F1EA]', spine: 'bg-[#262932]', border: 'border-[#4A4F5F]'},
  {bg: 'bg-[#5A3E2B]', text: 'text-[#FBF7F0]', spine: 'bg-[#422D1F]', border: 'border-[#73513A]'},
];

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export const BookCover: React.FC<BookCoverProps> = ({
  title,
  author,
  coverUrl,
  className = '',
  size = 'md',
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const palette = CLOTH_PALETTES[hashString(title + author) % CLOTH_PALETTES.length];

  const showFallback = !coverUrl || imgFailed;

  const titleSizeClass =
    size === 'sm'
      ? 'text-xs leading-tight'
      : size === 'lg'
        ? 'text-lg sm:text-xl leading-snug'
        : 'text-sm leading-snug';

  return (
    <div
      className={`relative aspect-[2/3] w-full overflow-hidden rounded-md border border-black/10 dark:border-white/10 shadow-sm ${palette.bg} ${className}`}
    >
      {/* Tactile clothbound typographic fallback (always present beneath or when image missing) */}
      <div
        className={`absolute inset-0 flex flex-col justify-between p-3 sm:p-4 ${palette.bg} ${palette.text}`}
      >
        {/* Subtle book spine crease */}
        <div
          aria-hidden="true"
          className={`absolute inset-y-0 left-0 w-2.5 ${palette.spine} opacity-80`}
        />
        <div className={`pl-2 border-t ${palette.border} pt-2`}>
          <p className="text-[10px] uppercase tracking-[0.16em] opacity-75 truncate">
            {author}
          </p>
        </div>
        <div className="pl-2 my-auto">
          <p className={`font-display font-medium ${titleSizeClass} line-clamp-4`}>
            {title}
          </p>
        </div>
        <div className={`pl-2 border-b ${palette.border} pb-1.5 flex items-center justify-between text-[9px] uppercase tracking-widest opacity-60`}>
          <span>Folio</span>
        </div>
      </div>

      {!showFallback && (
        <img
          src={coverUrl}
          alt={`Cover of ${title} by ${author}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setImgFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  );
};
