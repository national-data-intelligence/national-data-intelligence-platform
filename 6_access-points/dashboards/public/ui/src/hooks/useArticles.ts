/**
 * useArticles — fetch the public newsroom from /api/proxy/articles (→ gateway
 * /api/public/articles → ops_governance.public_article). Falls back to the
 * bundled ARTICLES only when the gateway returns nothing usable, so the page
 * always renders. Mirrors the useWidgetData null→fallback pattern.
 */
import { useEffect, useState } from 'react';
import { ARTICLES, type Article } from '../data/articles';
import { useProfile } from './useProfile';

function shape(a: any): Article | null {
  if (!a || !a.id || !a.title) return null;
  return {
    id:       String(a.id),
    date:     String(a.date ?? ''),
    category: String(a.category ?? ''),
    author:   String(a.author ?? ''),
    tags:     Array.isArray(a.tags) ? a.tags.map(String) : [],
    title:    String(a.title),
    summary:  String(a.summary ?? ''),
    body:     String(a.body ?? ''),
  };
}

export function useArticles(): Article[] {
  const [articles, setArticles] = useState<Article[] | null>(null);
  // The bundled ARTICLES are Ethiopian. A profile may carry its own, and a
  // Zambia deployment falling back to Ethiopian cholera bulletins would be a
  // worse failure than an empty newsroom — so a profile that sets
  // `articles: []` deliberately gets an empty one.
  const { copy } = useProfile();
  const fromProfile = copy?.articles as Article[] | undefined;
  useEffect(() => {
    let cancelled = false;
    fetch('/api/proxy/articles?limit=100')
      .then(r => (r.ok ? r.json() : null))
      .then(body => {
        const arr = Array.isArray(body?.articles) ? body.articles : null;
        if (cancelled || !arr) return;
        const mapped = arr.map(shape).filter((a: Article | null): a is Article => a !== null);
        if (mapped.length) setArticles(mapped);
      })
      .catch(() => { /* keep fallback */ });
    return () => { cancelled = true; };
  }, []);
  return articles ?? (Array.isArray(fromProfile) ? fromProfile : ARTICLES);
}
