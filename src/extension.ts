// src/extension.ts
import * as vscode from 'vscode';
import ollama from 'ollama';

const INST_PROMPT = 
  'You are a helpful code tutor. Your job is to teach the user with simple descriptions and sample code of the concept. Respond with a guided overview of the concept in a series of messages. Do not give the user the answer directly, but guide them to find the answer themselves. If the user asks a non-programming question, politely decline to respond.';

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "codawy" is now active!');

  // Register sidebar view
  const provider = new ChatViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('customChatView', provider)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('codawy.openCustomChat', () => {
      vscode.commands.executeCommand('workbench.view.extension.custom-chat-sidebar');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codawy.helloWorld', () => {
      vscode.window.showInformationMessage('Hello World from Codawy - Beyond LLM chats!');
    })
  );

  // Chat Participants
  const tutor = vscode.chat.createChatParticipant('codawy.codawy-tutor', tutorHandler);
  const coder = vscode.chat.createChatParticipant('codawy.codawy-coder', coderHandler);
  const echoer = vscode.chat.createChatParticipant('codawy.codawy-echo', echoHandler);
}

export function deactivate() {}

// Sidebar Chat View
class ChatViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };
    
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'sendMessage') {
        const response = await this._callChatAPI(message.text);
        webviewView.webview.postMessage({ command: 'receiveMessage', text: response });
      }
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Custom Chat</title>
        <style>
          body { padding: 10px; font-family: var(--vscode-font-family); }
          #chat-container { display: flex; flex-direction: column; height: 100vh; }
          #messages { flex: 1; overflow-y: auto; margin-bottom: 10px; }
          #input-container { display: flex; }
          #message-input { flex: 1; background-color: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 5px; }
          #send-button { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 5px 10px; margin-left: 5px; cursor: pointer; }
          .message { margin-bottom: 8px; padding: 5px; border-radius: 5px; }
          .user { background-color: var(--vscode-editor-background); }
          .assistant { background-color: var(--vscode-editor-inactiveSelectionBackground); }
        </style>
      </head>
      <body>
        <div id="chat-container">
          <div id="messages"></div>
          <div id="input-container">
            <input id="message-input" type="text" placeholder="Type your message...">
            <button id="send-button">Send</button>
          </div>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          const messageInput = document.getElementById('message-input');
          const sendButton = document.getElementById('send-button');
          const messagesContainer = document.getElementById('messages');
          
          sendButton.addEventListener('click', () => {
            const text = messageInput.value;
            if (text) {
              addMessage('user', text);
              vscode.postMessage({ command: 'sendMessage', text });
              messageInput.value = '';
            }
          });
          
          messageInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') sendButton.click();
          });
          
          window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'receiveMessage') {
              addMessage('assistant', message.text);
            }
          });
          
          function addMessage(sender, text) {
            const messageElement = document.createElement('div');
            messageElement.className = 'message ' + sender;
            messageElement.textContent = (sender === 'user' ? 'You: ' : 'Assistant: ') + text;
            messagesContainer.appendChild(messageElement);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }
        </script>
      </body>
      </html>
    `;
  }

  private async _callChatAPI(text: string): Promise<string> {
    try {
      const response = await ollama.chat({
        model: 'qwen2.5-coder:1.5b',
        messages: [{ role: 'user', content: text }],
      });
      return response.message.content;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

// Chat Handlers
const tutorHandler: vscode.ChatRequestHandler = async (
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
) => {
  const messages = [new vscode.LanguageModelChatMessage('user', INST_PROMPT)];
  messages.push(new vscode.LanguageModelChatMessage('user', request.prompt));
  
  const chatResponse = await request.model.sendRequest(messages, {}, token);
  for await (const fragment of chatResponse.text) {
    stream.markdown(fragment);
  }
};

const coderHandler: vscode.ChatRequestHandler = async (
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
) => {
  try {
    const chatResponse = await ollama.chat({
      model: 'qwen2.5-coder:1.5b',
      messages: [{ role: 'user', content: request.prompt }],
      stream: true
    });
    
    for await (const fragment of chatResponse) {
      stream.markdown(fragment.message.content);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    stream.markdown(errorMessage);
    vscode.window.showErrorMessage(errorMessage);
  }
};

const echoHandler: vscode.ChatRequestHandler = async (
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
) => {
  stream.markdown(request.prompt);
  
  const messages = context.history.map(item => {
    if (item instanceof vscode.ChatRequestTurn) {
      return `User: ${item.prompt}\n`;
    } else {
      let fullMessage = '';
      item.response.forEach(r => {
        const mdPart = r as vscode.ChatResponseMarkdownPart;
        fullMessage += mdPart.value.value;
      });
      return `Assistant: ${fullMessage}\n`;
    }
  });
  
  stream.markdown(messages.join('\n'));
};