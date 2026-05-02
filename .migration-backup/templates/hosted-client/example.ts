import { createPublicationClient } from '@publication-mcp-studio/client'

const publication = createPublicationClient({
  baseUrl: 'https://your-publication-service.example',
  token: process.env.PUBLICATION_API_TOKEN,
})

async function main() {
  const health = await publication.health()
  const articles = await publication.listArticles({ status: 'published', limit: 10 })
  const skills = await publication.listSkills()

  console.log({ health, articles, skills })
}

void main()
