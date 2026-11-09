/*
 * Adobe Web SDK (Alloy) for WebMCP tool-call analytics validation.
 * Consent is enforced inside the Web SDK: it starts as pending, then the demo
 * `?consent=` parameter is reconciled with setConsent before the WebMCP loader
 * is installed, so a previously persisted opt-in cannot leak a tool-call event.
 *   ?consent=accept|true|1|yes  opt in (also sends a page view)
 *   ?consent=pending            dev-only: leave consent pending
 *   anything else               opt out (site default)
 */

// Dev org and datastream.
export const ORG_ID = '908936ED5D35CC220A495CD4@AdobeOrg';
export const DATASTREAM_ID = '6af22481a574d809549b9d5b';

export const ALLOY_SRC = 'https://cdn1.adoberesources.net/alloy/2.37.1/alloy.min.js';
export const LOADER_SRC = 'https://d327fx17rhd87i.cloudfront.net/webmcp-store/delivery.js';
const CLIENT_KEY = 'astrocat';

/**
 * Maps the demo consent query parameter to a Web SDK consent mode.
 * @param {string} search The location search string
 * @returns {'in'|'out'|'pending'}
 */
export function getConsentMode(search) {
  const consent = new URLSearchParams(search).get('consent')?.toLowerCase();
  if (['accept', 'true', '1', 'yes'].includes(consent)) return 'in';
  if (consent === 'pending') return 'pending';
  return 'out';
}

/**
 * Installs Adobe's official Web SDK base code command queue for `alloy`.
 * @param {Window} win The window object
 */
export function installAlloyQueue(win) {
  if (win.alloy) return;
  /* eslint-disable no-underscore-dangle -- name defined by the Web SDK base code */
  win.__alloyNS = win.__alloyNS || [];
  win.__alloyNS.push('alloy');
  /* eslint-enable no-underscore-dangle */
  win.alloy = (...args) => new Promise((resolve, reject) => {
    win.alloy.q.push([resolve, reject, args]);
  });
  win.alloy.q = [];
}

function appendScript(doc, src, dataset = {}) {
  const script = doc.createElement('script');
  script.src = src;
  script.async = true;
  Object.assign(script.dataset, dataset);
  doc.head.append(script);
}

const consentPayload = (val) => ({
  consent: [{ standard: 'Adobe', version: '2.0', value: { collect: { val } } }],
});

/**
 * Configures the Web SDK, reconciles consent, and then installs the WebMCP loader.
 * @returns {Promise<boolean>} true if the WebMCP loader was installed
 */
export async function initWebSdk({
  win = window,
  doc = document,
  orgId = ORG_ID,
  datastreamId = DATASTREAM_ID,
} = {}) {
  if (orgId.startsWith('<') || datastreamId.startsWith('<')) {
    // eslint-disable-next-line no-console
    console.warn('Web SDK not configured: set ORG_ID and DATASTREAM_ID in scripts/websdk.js');
    return false;
  }

  installAlloyQueue(win);
  appendScript(doc, ALLOY_SRC);

  const mode = getConsentMode(win.location.search);
  try {
    await win.alloy('configure', { orgId, datastreamId, defaultConsent: 'pending' });
    if (mode !== 'pending') await win.alloy('setConsent', consentPayload(mode === 'in' ? 'y' : 'n'));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Web SDK setup failed; WebMCP loader not installed', error);
    return false;
  }

  if (mode === 'in') {
    win.alloy('sendEvent', {
      xdm: {
        eventType: 'web.webpagedetails.pageViews',
        web: { webPageDetails: { name: doc.title, pageViews: { value: 1 } } },
      },
    // eslint-disable-next-line no-console
    }).catch((error) => console.error('Web SDK page view failed', error));
  }

  appendScript(doc, LOADER_SRC, { clientKey: CLIENT_KEY });
  return true;
}
