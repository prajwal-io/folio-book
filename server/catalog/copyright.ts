import type {BookAuthor, CopyrightStatus, FreeAccessType} from '../../src/types/library.ts';

/**
 * Evaluates legal free-access eligibility including:
 * - Explicit Creative Commons / Open Access licenses (2000-2026+)
 * - Official publisher free libraries & authorized free author editions
 * - Indian Copyright Act, 1957 (Section 22): life + 60 years for public-domain works
 */
export function evaluateCopyrightForIndia(
  authors: BookAuthor[],
  providerFlags: {
    gutenbergCopyright?: boolean | null;
    isCC0OrPublicDomain?: boolean;
    isCCBySa?: boolean;
    explicitCCLicense?: string | null;
    isPublisherFreeLibrary?: boolean;
    isAuthorFreeEdition?: boolean;
  },
): {
  status: CopyrightStatus;
  freeAccessType: FreeAccessType;
  note: string;
  allowInCatalog: boolean;
} {
  if (providerFlags.explicitCCLicense) {
    return {
      status: 'open-license-cc',
      freeAccessType: 'open-access-cc',
      note: `Openly licensed (${providerFlags.explicitCCLicense}) for legal free reading worldwide.`,
      allowInCatalog: true,
    };
  }

  if (providerFlags.isPublisherFreeLibrary) {
    return {
      status: 'publisher-free-edition',
      freeAccessType: 'publisher-free-library',
      note: 'Authorized complete free edition published by the rights-holding publisher.',
      allowInCatalog: true,
    };
  }

  if (providerFlags.isAuthorFreeEdition) {
    return {
      status: 'author-free-edition',
      freeAccessType: 'author-free-edition',
      note: 'Legally free full edition offered directly by the author or authorized free platform.',
      allowInCatalog: true,
    };
  }

  const currentYear = new Date().getFullYear();
  const indiaCutoffYear = currentYear - 61;

  if (providerFlags.isCCBySa) {
    return {
      status: 'open-license-cc',
      freeAccessType: 'open-access-cc',
      note: 'Openly licensed (CC BY-SA / Public Domain) for free global reading.',
      allowInCatalog: true,
    };
  }

  const knownDeathYears = authors
    .map((a) => a.deathYear)
    .filter((y): y is number => typeof y === 'number' && y > 0);

  if (knownDeathYears.length > 0) {
    const latestDeath = Math.max(...knownDeathYears);
    if (latestDeath <= indiaCutoffYear) {
      return {
        status: 'public-domain-india-and-global',
        freeAccessType: 'public-domain',
        note: `Public domain in India and worldwide (author died ${latestDeath}; India term is life + 60 years).`,
        allowInCatalog: true,
      };
    }
    return {
      status: 'public-domain-us-verify-india',
      freeAccessType: 'public-domain',
      note: `Author died ${latestDeath}; US public domain status may differ from India's life + 60 year term.`,
      allowInCatalog: false,
    };
  }

  if (providerFlags.isCC0OrPublicDomain) {
    return {
      status: 'public-domain-india-and-global',
      freeAccessType: 'public-domain',
      note: 'Public domain edition curated by Standard Ebooks.',
      allowInCatalog: true,
    };
  }

  if (providerFlags.gutenbergCopyright === false) {
    return {
      status: 'public-domain-india-and-global',
      freeAccessType: 'public-domain',
      note: 'Public domain record verified by Project Gutenberg (pre-1931 / no copyright claimed).',
      allowInCatalog: true,
    };
  }

  return {
    status: 'public-domain-us-verify-india',
    freeAccessType: 'public-domain',
    note: 'Openly accessible public scan; verify local copyright status if author dates are unlisted.',
    allowInCatalog: true,
  };
}
