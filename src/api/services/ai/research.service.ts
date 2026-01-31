import axios from "axios";

interface ResearchResult {
  sources: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
  keywords: string[];
  summary: string;
}

interface UserApiKeys {
  openai?: string;
  anthropic?: string;
  perplexity?: string;
}

/**
 * Search using Perplexity API
 */
async function searchWithPerplexity(
  query: string,
  apiKey: string
): Promise<{ content: string; citations: string[] }> {
  try {
    const response = await axios.post(
      "https://api.perplexity.ai/chat/completions",
      {
        model: "llama-3.1-sonar-small-128k-online",
        messages: [
          {
            role: "system",
            content:
              "You are a research assistant. Provide comprehensive information with citations and sources.",
          },
          {
            role: "user",
            content: `Research the following topic thoroughly, including books, academic research, and recent news: ${query}`,
          },
        ],
        max_tokens: 2000,
        return_citations: true,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    const content = response.data.choices[0].message.content;
    const citations = response.data.citations || [];

    return { content, citations };
  } catch (error) {
    console.error("Perplexity search error:", error);
    throw new Error("Perplexity search failed");
  }
}

/**
 * Search for books and academic works using OpenAI
 */
async function searchBooks(
  query: string,
  openaiKey: string
): Promise<string> {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4-turbo-preview",
        messages: [
          {
            role: "system",
            content: `You are a librarian and academic researcher. When given a topic, 
            list the most influential and famous books, research papers, and academic 
            works related to that topic. Include author names, publication years, and 
            brief descriptions of key concepts from each work.`,
          },
          {
            role: "user",
            content: `List the most famous and influential books and academic works about: ${query}`,
          },
        ],
        max_tokens: 1500,
      },
      {
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error("Book search error:", error);
    return "";
  }
}

/**
 * Extract keywords from research summary
 */
async function extractKeywords(
  summary: string,
  apiKey: string,
  provider: "openai" | "anthropic"
): Promise<string[]> {
  try {
    const systemPrompt = `Extract 5-10 important keywords from the following text. 
    Return only the keywords as a JSON array of strings, like ["keyword1", "keyword2"].`;

    if (provider === "openai") {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4-turbo-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: summary },
          ],
          max_tokens: 200,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      const text = response.data.choices[0].message.content;
      const match = text.match(/\[.*\]/s);
      if (match) {
        return JSON.parse(match[0]);
      }
    } else {
      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 200,
          messages: [{ role: "user", content: `${systemPrompt}\n\n${summary}` }],
        },
        {
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
          },
        }
      );

      const text = response.data.content[0].text;
      const match = text.match(/\[.*\]/s);
      if (match) {
        return JSON.parse(match[0]);
      }
    }

    return [];
  } catch (error) {
    console.error("Keyword extraction error:", error);
    return [];
  }
}

/**
 * Synthesize research into a comprehensive summary
 */
async function synthesizeResearch(
  topic: string,
  webSearch: string,
  bookSearch: string,
  apiKey: string,
  provider: "openai" | "anthropic"
): Promise<string> {
  const prompt = `Synthesize the following research into a comprehensive summary about "${topic}".
  Include key facts, statistics, and insights that would be useful for creating educational video content.

  Web Research:
  ${webSearch}

  Books & Academic Research:
  ${bookSearch}

  Create a well-organized summary that covers:
  1. Key facts and statistics
  2. Important concepts and theories
  3. Interesting angles for storytelling
  4. Common misconceptions to address`;

  try {
    if (provider === "openai") {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4-turbo-preview",
          messages: [
            {
              role: "system",
              content: "You are a research synthesizer. Create comprehensive summaries from multiple sources.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 2000,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      return response.data.choices[0].message.content;
    } else {
      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 2000,
          messages: [{ role: "user", content: prompt }],
        },
        {
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
          },
        }
      );
      return response.data.content[0].text;
    }
  } catch (error) {
    console.error("Synthesis error:", error);
    throw new Error("Failed to synthesize research");
  }
}

/**
 * Main research function
 */
export async function performResearch(
  topic: string,
  apiKeys: UserApiKeys
): Promise<ResearchResult> {
  const provider = apiKeys.openai ? "openai" : "anthropic";
  const llmKey = apiKeys.openai || apiKeys.anthropic;

  if (!llmKey) {
    throw new Error("No LLM API key available");
  }

  // Perform parallel searches
  const [perplexityResult, bookResult] = await Promise.all([
    apiKeys.perplexity
      ? searchWithPerplexity(topic, apiKeys.perplexity)
      : Promise.resolve({ content: "", citations: [] as string[] }),
    apiKeys.openai
      ? searchBooks(topic, apiKeys.openai)
      : Promise.resolve(""),
  ]);

  // Synthesize all research
  const summary = await synthesizeResearch(
    topic,
    perplexityResult.content,
    bookResult,
    llmKey,
    provider
  );

  // Extract keywords
  const keywords = await extractKeywords(summary, llmKey, provider);

  // Build sources array
  const sources: ResearchResult["sources"] = [];

  // Add perplexity citations as sources
  if (perplexityResult.citations) {
    perplexityResult.citations.forEach((citation: string, index: number) => {
      sources.push({
        title: `Source ${index + 1}`,
        url: citation,
        snippet: "Research citation",
      });
    });
  }

  return {
    sources,
    keywords,
    summary,
  };
}
