import { SplendorPlayer, type Observation } from 'splendor';

// Replace these with your provider's HTTPS endpoint and model name.
const ENDPOINT = 'https://your-provider.example/v1/chat/completions';
const MODEL = 'your-model';

export default class LlmPlayer extends SplendorPlayer {
  async chooseAction(view: Observation) {
    const key = this.getSecret('API_KEY');
    if (!key) throw new Error('Configure a private API key in the workshop');
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 100,
        messages: [
          {
            role: 'system',
            content:
              'Play vanilla Splendor. Choose an index from legalActions. Reply only with JSON: {"index": number}.',
          },
          { role: 'user', content: JSON.stringify(view) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Provider returned ${response.status}`);
    const completion = await response.json();
    const { index } = JSON.parse(completion.choices[0].message.content);
    if (!Number.isInteger(index) || index < 0 || index >= view.legalActions.length)
      throw new Error('Provider returned an invalid action index');
    return view.legalActions[index];
  }
}
