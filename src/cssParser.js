function parseCssRules(css) {
  if (!css || typeof css !== 'string') return [];

  const rules = [];
  const ruleRegex = /([^{}]+)\{([^}]*)\}/g;
  let match;

  while ((match = ruleRegex.exec(css)) !== null) {
    const selector = match[1].trim();
    const declarations = match[2].trim();

    const properties = {};
    const decls = declarations.split(';');
    for (const decl of decls) {
      const parts = decl.split(':').map(s => s.trim());
      if (parts.length >= 2) {
        const prop = parts[0].trim();
        const value = parts.slice(1).join(':').trim();
        if (prop && value) {
          properties[prop] = value;
        }
      }
    }

    if (Object.keys(properties).length > 0) {
      rules.push({ selector, properties });
    }
  }

  return rules;
}

function elementMatchesSelector(element, selector) {
  const tagName = element.name || '';
  const classes = (element.attribs.class || '').split(/\s+/).filter(Boolean);
  const id = element.attribs.id || '';

  const selectors = selector.split(',').map(s => s.trim());

  for (const sel of selectors) {
    let parts = sel.trim();

    let tagMatch = '';
    let classMatches = [];
    let idMatch = '';

    const tokens = parts.trim().split(/\s+/);
    for (const token of tokens) {
      if (token.startsWith('#')) {
        idMatch = token.slice(1);
      } else if (token.startsWith('.')) {
        classMatches.push(token.slice(1));
      } else {
        tagMatch = token;
      }
    }

    if (tagMatch && tagMatch.toLowerCase() !== tagName.toLowerCase()) continue;
    if (idMatch && idMatch !== id) continue;
    for (const cls of classMatches) {
      if (!classes.includes(cls)) continue;
    }
    return true;
  }

  return false;
}

function applyCssToElements($, css) {
  if (!css || typeof css !== 'string') return;

  const rules = parseCssRules(css);

  for (const rule of rules) {
    const selector = rule.selector;

    try {
      const elements = $(selector);
      elements.each((_index, element) => {
        if (element.type === 'tag') {
          const existingStyle = element.attribs.style || '';
          const newStyle = Object.entries(rule.properties)
            .map(([key, value]) => `${key}: ${value}`)
            .join('; ');

          if (newStyle) {
            element.attribs.style = existingStyle
              ? newStyle + '; ' + existingStyle
              : newStyle;
          }
        }
      });
    } catch {
      try {
        const cleanSelector = selector
          .replace(/\[.*?\]/g, '')
          .replace(/:.*?(?=[ ,{]|$)/g, '')
          .trim();

        if (cleanSelector) {
          const elements = $(cleanSelector);
          elements.each((_index, element) => {
            if (element.type === 'tag') {
              const existingStyle = element.attribs.style || '';
              const newStyle = Object.entries(rule.properties)
                .map(([key, value]) => `${key}: ${value}`)
                .join('; ');

              if (newStyle) {
                element.attribs.style = existingStyle
                  ? newStyle + '; ' + existingStyle
                  : newStyle;
              }
            }
          });
        }
      } catch {
        // Skip unsupported selectors
      }
    }
  }
}

export { parseCssRules, elementMatchesSelector, applyCssToElements };
