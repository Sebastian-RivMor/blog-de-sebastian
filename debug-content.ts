
import { getCollection } from 'astro:content';

async function checkContent() {
  try {
    const posts = await getCollection('blog');
    console.log('Posts found:', posts.length);
    posts.forEach(p => console.log('Post ID:', p.id, 'Data:', JSON.stringify(p.data)));
  } catch (e) {
    console.error('Error fetching collection:', e);
  }
}

checkContent();
