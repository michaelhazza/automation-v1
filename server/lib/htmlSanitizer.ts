import sanitizeHtml from 'sanitize-html';

const MAX_HTML_SIZE = 1024 * 1024; // 1MB

const ALLOWED_IFRAME_HOSTS = [
  'link.msgsndr.com',
  'js.stripe.com',
  'buy.stripe.com',
  'www.youtube.com',
  'player.vimeo.com',
  'calendly.com',
];

/**
 * Sanitizes agent-written page HTML with an allowlist approach.
 *
 * - Strips `<script>` tags, `javascript:` URIs, and `on*` event handler attributes
 * - Preserves standard HTML, CSS classes, inline styles, images, videos, forms, SVG
 * - Allows `<iframe>` only from explicitly allowed domains
 *
 * Throws `{ statusCode: 413 }` if the HTML exceeds 1MB.
 */
export function sanitizePageHtml(html: string): string {
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_SIZE) {
    throw { statusCode: 413, message: 'Page HTML exceeds maximum size of 1MB' };
  }

  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      // Structure & content
      'html', 'head', 'body', 'main', 'nav', 'header', 'footer', 'section', 'article', 'aside',
      'figure', 'figcaption', 'details', 'summary', 'dialog', 'template', 'slot',
      // Media
      'img', 'picture', 'source', 'video', 'audio', 'track', 'canvas',
      // Forms
      'form', 'input', 'textarea', 'select', 'option', 'optgroup', 'button', 'label',
      'fieldset', 'legend', 'datalist', 'output', 'progress', 'meter',
      // Tables (already in defaults but explicit)
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
      // Inline / text
      'span', 'div', 'a', 'p', 'br', 'hr', 'wbr', 'mark', 'small', 'time', 'data', 'abbr',
      'cite', 'dfn', 'kbd', 'samp', 'var', 'ruby', 'rt', 'rp', 'bdi', 'bdo',
      // SVG
      'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
      'text', 'tspan', 'defs', 'use', 'symbol', 'clipPath', 'mask', 'pattern',
      'linearGradient', 'radialGradient', 'stop', 'filter', 'feGaussianBlur',
      'feOffset', 'feMerge', 'feMergeNode', 'feBlend', 'feColorMatrix',
      'feComponentTransfer', 'feComposite', 'feFlood', 'feImage', 'feMorphology',
      'feTurbulence', 'foreignObject',
      // Head elements
      'title', 'meta', 'link', 'style',
      // Iframe (filtered by transformTags below)
      'iframe',
    ]),
    allowedAttributes: {
      '*': ['class', 'id', 'style', 'title', 'lang', 'dir', 'role', 'aria-*', 'data-*',
            'tabindex', 'hidden', 'draggable'],
      a: ['href', 'target', 'rel', 'download', 'hreflang', 'type'],
      img: ['src', 'srcset', 'alt', 'width', 'height', 'loading', 'decoding', 'crossorigin', 'sizes'],
      video: ['src', 'poster', 'width', 'height', 'controls', 'autoplay', 'loop', 'muted',
              'preload', 'playsinline', 'crossorigin'],
      audio: ['src', 'controls', 'autoplay', 'loop', 'muted', 'preload', 'crossorigin'],
      source: ['src', 'srcset', 'type', 'media', 'sizes'],
      track: ['src', 'kind', 'srclang', 'label', 'default'],
      iframe: ['src', 'width', 'height', 'frameborder', 'allow', 'allowfullscreen',
               'loading', 'title', 'name', 'sandbox'],
      form: ['action', 'method', 'enctype', 'target', 'novalidate', 'autocomplete', 'name'],
      input: ['type', 'name', 'value', 'placeholder', 'required', 'disabled', 'readonly',
              'checked', 'maxlength', 'minlength', 'min', 'max', 'step', 'pattern',
              'autocomplete', 'autofocus', 'multiple', 'accept', 'size', 'list', 'form'],
      textarea: ['name', 'rows', 'cols', 'placeholder', 'required', 'disabled', 'readonly',
                  'maxlength', 'minlength', 'wrap', 'autocomplete', 'autofocus', 'form'],
      select: ['name', 'required', 'disabled', 'multiple', 'size', 'autocomplete', 'form'],
      option: ['value', 'selected', 'disabled', 'label'],
      optgroup: ['label', 'disabled'],
      button: ['type', 'name', 'value', 'disabled', 'form', 'formaction', 'formmethod'],
      label: ['for'],
      th: ['colspan', 'rowspan', 'scope', 'headers'],
      td: ['colspan', 'rowspan', 'headers'],
      col: ['span'],
      colgroup: ['span'],
      meta: ['charset', 'name', 'content', 'property'],
      link: ['rel', 'href', 'type', 'media', 'sizes', 'crossorigin', 'as'],
      style: ['type', 'media'],
      time: ['datetime'],
      data: ['value'],
      progress: ['value', 'max'],
      meter: ['value', 'min', 'max', 'low', 'high', 'optimum'],
      output: ['for', 'name', 'form'],
      canvas: ['width', 'height'],
      picture: [],
      // SVG attributes
      svg: ['xmlns', 'viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width',
            'stroke-linecap', 'stroke-linejoin', 'preserveAspectRatio'],
      path: ['d', 'fill', 'stroke', 'stroke-width', 'transform', 'opacity'],
      circle: ['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'transform'],
      rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'transform'],
      line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'transform'],
      polyline: ['points', 'fill', 'stroke', 'stroke-width', 'transform'],
      polygon: ['points', 'fill', 'stroke', 'stroke-width', 'transform'],
      ellipse: ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'transform'],
      text: ['x', 'y', 'dx', 'dy', 'text-anchor', 'font-size', 'font-family', 'fill', 'transform'],
      tspan: ['x', 'y', 'dx', 'dy'],
      use: ['href', 'x', 'y', 'width', 'height'],
      symbol: ['viewBox', 'preserveAspectRatio'],
      clipPath: ['id'],
      mask: ['id'],
      linearGradient: ['id', 'x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform'],
      radialGradient: ['id', 'cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform'],
      stop: ['offset', 'stop-color', 'stop-opacity'],
      g: ['transform', 'fill', 'stroke', 'opacity'],
      filter: ['id', 'x', 'y', 'width', 'height'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesAppliedToAttributes: ['href', 'src', 'action', 'cite', 'poster'],
    allowVulnerableTags: false,
    transformTags: {
      iframe: (tagName, attribs) => {
        const src = attribs.src || '';
        try {
          const url = new URL(src);
          if (ALLOWED_IFRAME_HOSTS.includes(url.hostname)) {
            return { tagName, attribs };
          }
        } catch {
          // Invalid URL — strip the iframe
        }
        return { tagName: '', attribs: {} };
      },
    },
  });
}
