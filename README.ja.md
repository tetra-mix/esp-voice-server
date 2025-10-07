# esp-voice-server

ESP32/M5Stack デバイス向けの高性能 WebSocket ベース音声処理バックエンド。リアルタイムオーディオストリーミング、文字起こし、音声合成に対応。

## 特徴

- **WebSocket PCM ストリーミング**: 効率的なオーディオストリーミングのためのカスタム PCM1 プロトコル
- **プラグインアーキテクチャ**: 文字起こし、音声合成、会話生成のための柔軟なプラグインシステム
- **セッション管理**: 自動セッションライフサイクルとバッファ管理
- **M5Stack 互換**: RSV ビット処理を含む M5Stack ESP32 デバイスの最適化
- **TypeScript**: 完全な型安全性と IDE サポート
- **モジュラー設計**: 必要な機能だけを使用可能（高レベルサーバーまたは低レベルコンポーネント）
- **環境変数不要**: すべての設定をコードで管理

## このライブラリが提供するもの

`esp-voice-server` は、ESP32/M5Stack デバイス向け WebSocket ベース音声ストリーミングの**低レベルの複雑さを抽象化する**フレームワークです。「音声ストリーミングのための Express」と考えてください。

### 含まれるもの
- ✅ PCM1 プロトコル対応 WebSocket サーバー
- ✅ セッション管理とオーディオバッファリング
- ✅ オーディオフォーマット変換ユーティリティ（MP3/WAV ↔ PCM）
- ✅ M5Stack 固有の互換性処理
- ✅ 拡張性のためのプラグインインターフェース

### 含まれないもの（実装が必要）
- ❌ 音声認識（Whisper、Google Speech など）
- ❌ LLM 統合（GPT、Claude、Mastra など）
- ❌ テキスト読み上げエンジン（OpenAI TTS、AivisSpeech など）
- ❌ データベース操作

**プロトコルの詳細ではなく、ビジネスロジックに集中できます。**

## インストール

```bash
npm install esp-voice-server
# または
pnpm add esp-voice-server
# または
yarn add esp-voice-server
```

### ピア依存関係

使用したいサービスに応じてインストール：

```bash
# OpenAI Whisper 文字起こしと TTS 用
npm install openai

# Google Cloud Speech 用
npm install @google-cloud/speech
```

## クイックスタート

```typescript
import { VoiceServer } from 'esp-voice-server'
import type { TranscriptionPlugin, ConversationPlugin, SynthesisPlugin } from 'esp-voice-server'

// 1. 文字起こしプラグインを実装
const transcriptionPlugin: TranscriptionPlugin = {
  name: 'whisper',
  async transcribe(audioBuffer, header) {
    // ここに文字起こしロジックを記述
    return '文字起こしされたテキスト'
  }
}

// 2. 会話生成プラグインを実装
const conversationPlugin: ConversationPlugin = {
  name: 'gpt',
  async generate(userInput, context) {
    // ここに会話生成ロジックを記述
    return '生成された応答'
  }
}

// 3. 音声合成プラグインを実装
const synthesisPlugin: SynthesisPlugin = {
  name: 'tts',
  async synthesize(text) {
    // ここに TTS ロジックを記述
    return Buffer.from([/* オーディオデータ */])
  }
}

// 4. サーバーを作成して起動
const server = new VoiceServer({
  websocket: {
    port: 3000,
    path: '/pcm/stream',
    host: '0.0.0.0'
  },
  session: {
    maxBytes: 5 * 1024 * 1024,  // 5MB
    maxDurationMs: 60_000,       // 60秒
    maxChunks: 200,
    idleTimeoutMs: 5_000         // 5秒
  },
  pipeline: {
    transcription: transcriptionPlugin,
    conversation: conversationPlugin,
    synthesis: synthesisPlugin,
    verbose: true
  }
})

server.start()

// グレースフルシャットダウン
process.on('SIGINT', async () => {
  await server.stop()
  process.exit(0)
})
```

## 完全なプラグイン実装例

### OpenAI Whisper 文字起こし

```typescript
import OpenAI from 'openai'
import { wrapPcmToWav } from 'esp-voice-server'
import type { TranscriptionPlugin, PcmHeader } from 'esp-voice-server'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const whisperPlugin: TranscriptionPlugin = {
  name: 'openai-whisper',
  async transcribe(audioBuffer: Buffer, header: PcmHeader): Promise<string | null> {
    try {
      // PCM を WAV フォーマットに変換
      const wavBuffer = wrapPcmToWav(
        audioBuffer,
        header.sample_rate,
        header.channels,
        header.bits
      )

      // OpenAI API 用の File オブジェクトを作成
      const file = new File([wavBuffer], 'audio.wav', { type: 'audio/wav' })

      // Whisper で文字起こし
      const response = await openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        language: 'ja' // または 'en'
      })

      return response.text
    } catch (error) {
      console.error('Whisper transcription error:', error)
      return null
    }
  }
}
```

### GPT 会話生成

```typescript
import OpenAI from 'openai'
import type { ConversationPlugin, ConversationContext } from 'esp-voice-server'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const gptPlugin: ConversationPlugin = {
  name: 'gpt-4o-mini',
  async generate(userInput: string, context: ConversationContext): Promise<string | null> {
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'あなたは優しく会話する音声アシスタントです。'
          },
          {
            role: 'user',
            content: userInput
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      })

      return response.choices[0]?.message?.content || null
    } catch (error) {
      console.error('GPT generation error:', error)
      return null
    }
  }
}
```

### OpenAI TTS 音声合成

```typescript
import OpenAI from 'openai'
import { convertMp3ToPcmWithHeader } from 'esp-voice-server'
import type { SynthesisPlugin } from 'esp-voice-server'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const ttsPlugin: SynthesisPlugin = {
  name: 'openai-tts',
  async synthesize(text: string): Promise<Buffer | null> {
    try {
      // OpenAI TTS で音声を生成
      const mp3Response = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'alloy',
        input: text,
        response_format: 'mp3'
      })

      const mp3Buffer = Buffer.from(await mp3Response.arrayBuffer())

      // M5Stack 用に MP3 を PCM（ヘッダー付き）に変換
      const pcmWithHeader = await convertMp3ToPcmWithHeader(mp3Buffer, {
        targetSampleRate: 16000,
        verbose: false
      })

      return pcmWithHeader
    } catch (error) {
      console.error('TTS synthesis error:', error)
      return null
    }
  }
}
```

### 完全なサーバー実装例

```typescript
import { VoiceServer } from 'esp-voice-server'

const server = new VoiceServer({
  websocket: {
    port: 3000,
    path: '/pcm/stream',
    host: '0.0.0.0',
    pingInterval: 15000,           // ハートビート間隔
    maxPayload: 10 * 1024 * 1024,  // 最大メッセージサイズ 10MB
    perMessageDeflate: false,      // M5Stack 互換性のため無効化
    skipUTF8Validation: true       // M5Stack RSV ビット互換性
  },
  session: {
    maxBytes: 5 * 1024 * 1024,  // セッションあたり最大 5MB のオーディオ
    maxDurationMs: 60_000,       // 60秒タイムアウト
    maxChunks: 200,              // 最大 200 オーディオチャンク
    idleTimeoutMs: 5_000         // 5秒アイドルタイムアウト
  },
  pipeline: {
    transcription: whisperPlugin,
    conversation: gptPlugin,
    synthesis: ttsPlugin,
    verbose: true  // デバッグログを有効化
  }
})

server.start()
console.log('✓ 音声サーバーが ws://0.0.0.0:3000/pcm/stream で起動しました')
```

## アーキテクチャ

### コアモジュール

- **PCM 処理** (`core/pcm.ts`): PCM1 ヘッダー解析、WAV 変換、オーディオユーティリティ
- **オーディオ変換** (`core/audio-conversion.ts`): MP3/WAV 変換、リサンプリング、デコード
- **WebSocket サーバー** (`core/websocket.ts`): PCM1 プロトコル対応 WebSocket サーバー
- **セッション管理** (`core/session.ts`): ストリーミングセッションのライフサイクルとバッファリング

### プラグインシステム

最大限の柔軟性のためにプラグインアーキテクチャを使用：

#### TranscriptionPlugin（文字起こしプラグイン）
オーディオをテキストに変換：
```typescript
interface TranscriptionPlugin {
  name: string
  transcribe(audioBuffer: Buffer, header: PcmHeader): Promise<string | null>
}
```

対応実装：
- OpenAI Whisper
- Google Cloud Speech-to-Text
- Azure Speech Services
- カスタムモデル統合

#### ConversationPlugin（会話プラグイン）
会話応答を生成：
```typescript
interface ConversationPlugin {
  name: string
  generate(userInput: string, context: ConversationContext): Promise<string | null>
  storeHistory?(context: ConversationContext, userMessage: string, assistantMessage: string): Promise<void>
}
```

対応実装：
- OpenAI GPT-4/GPT-3.5
- Anthropic Claude
- Google Gemini
- Mastra ワークフロー
- カスタム LLM 統合

#### SynthesisPlugin（音声合成プラグイン）
テキストをオーディオに変換：
```typescript
interface SynthesisPlugin {
  name: string
  synthesize(text: string): Promise<Buffer | null>
}
```

対応実装：
- OpenAI TTS
- AivisSpeech（日本語）
- Google Cloud Text-to-Speech
- Azure Speech Services
- カスタム TTS エンジン

## PCM1 プロトコル

効率的なオーディオストリーミングのためのカスタム PCM1 ヘッダーフォーマット：

```
バイト 0-3:   マジック "PCM1"
バイト 4-7:   サンプルレート (uint32, リトルエンディアン)
バイト 8:     チャンネル数 (uint8)
バイト 9:     ビット深度 (uint8)
バイト 10-11: フレームサンプル数 (uint16, リトルエンディアン)
バイト 12-13: 予約領域 (uint16)
バイト 14-15: パディング (uint16)
```

**標準設定**: 16kHz、16ビット、モノラル、320サンプル/フレーム（20ms）

### プロトコルフロー

1. **クライアント → サーバー**: PCM1 ヘッダー（16バイト）
2. **サーバー → クライアント**: JSON 確認応答
3. **クライアント → サーバー**: オーディオチャンク（PCM データ）
4. **クライアント → サーバー**: END 信号（テキスト "END" + null バイト）
5. **サーバー**: パイプラインを通じてオーディオを処理
6. **サーバー → クライアント**: 文字起こし結果（JSON）
7. **サーバー → クライアント**: 応答テキスト（JSON）
8. **サーバー → クライアント**: 合成オーディオ（PCM1 フォーマット）
9. **サーバー → クライアント**: 新規セッション準備完了（JSON）

### WebSocket メッセージ

#### クライアントからサーバーへ
```typescript
// バイナリ: PCM1 ヘッダー + オーディオデータ
Buffer: [PCM1 magic][sample_rate][channels][bits][frame_samps][reserved][audio data...]

// テキスト: 制御メッセージ
"END\0"           // 現在のストリームを終了
"AUTH:user_id"    // セッション認証
```

#### サーバーからクライアントへ
```typescript
// JSON: ステータスメッセージ
{ type: 'header_received', sessionId: '...', format: {...} }
{ type: 'transcription', text: '...' }
{ type: 'response', text: '...' }
{ type: 'session_ready', sessionId: '...' }
{ type: 'auth_success', userId: '...' }
{ type: 'error', message: '...' }

// バイナリ: オーディオ応答（PCM1 フォーマット + "END\0" マーカー）
```

## 高度な使い方

### コアモジュールのみを使用

完全なパイプラインが不要で、処理を手動で行いたい場合：

```typescript
import { VoiceWebSocketServer, SessionManager } from 'esp-voice-server'

// セッションマネージャーを作成
const sessionManager = new SessionManager({
  maxBytes: 5 * 1024 * 1024,
  maxDurationMs: 60_000,
  maxChunks: 200,
  idleTimeoutMs: 5_000
}, {
  onCreate: (session) => console.log(`セッション ${session.sessionId} を作成`),
  onEnd: (session) => console.log(`セッション ${session.sessionId} を終了`),
  onLimitExceeded: (session, reason) => console.warn(`制限超過: ${reason}`)
})

// WebSocket サーバーを作成
const wsServer = new VoiceWebSocketServer({
  port: 3000,
  path: '/pcm/stream'
}, {
  onConnection: (ws, sessionId) => {
    sessionManager.createSession(sessionId)
  },
  onMessage: async (ws, sessionId, message) => {
    if (message.type === 'header') {
      // PCM ヘッダーを保存
      sessionManager.setHeader(sessionId, message.header)
      console.log('ヘッダー:', message.header)
    } else if (message.type === 'audio') {
      // オーディオチャンクをバッファリング
      sessionManager.addChunk(sessionId, message.data)
    } else if (message.type === 'end') {
      // バッファリングされたすべてのオーディオを取得
      const audioData = sessionManager.getAudioData(sessionId)

      // ここでオーディオを手動で処理
      // ...

      await sessionManager.endSession(sessionId)
    }
  },
  onClose: (ws, sessionId) => {
    sessionManager.endSession(sessionId)
  }
})

wsServer.start()
```

### オーディオフォーマット変換ユーティリティ

オーディオフォーマット間の変換ユーティリティを提供：

```typescript
import {
  convertMp3ToPcmWithHeader,
  convertWavToPcmWithHeader,
  wrapPcmToWav,
  parsePcmHeader
} from 'esp-voice-server'

// MP3 を PCM1 ヘッダー付き PCM に変換
const pcmWithHeader = await convertMp3ToPcmWithHeader(mp3Buffer, {
  targetSampleRate: 16000,
  verbose: true
})

// WAV を PCM1 ヘッダー付き PCM に変換
const pcmWithHeader2 = convertWavToPcmWithHeader(wavBuffer, 16000)

// 生 PCM データを WAV コンテナでラップ
const wavBuffer = wrapPcmToWav(
  pcmData,      // 生 PCM データ
  16000,        // サンプルレート
  1,            // チャンネル数（モノラル）
  16            // ビット深度
)

// バッファから PCM1 ヘッダーを解析
const { header, pcmData } = parsePcmHeader(buffer)
console.log('サンプルレート:', header.sample_rate)
console.log('チャンネル数:', header.channels)
console.log('ビット深度:', header.bits)
```

### セッション管理 API

`SessionManager` は詳細なセッション制御を提供：

```typescript
// セッションを作成
const session = sessionManager.createSession('session-123')

// PCM ヘッダーを設定
sessionManager.setHeader('session-123', pcmHeader)

// オーディオチャンクを追加
sessionManager.addChunk('session-123', audioBuffer)

// セッション情報を取得
const session = sessionManager.getSession('session-123')
console.log('総バイト数:', session?.totalBytes)

// バッファリングされたすべてのオーディオを取得
const audioData = sessionManager.getAudioData('session-123')

// セッション統計を取得
const stats = sessionManager.getStats('session-123')
console.log('継続時間:', stats?.duration)
console.log('チャンク数:', stats?.chunkCount)

// セッションにカスタムデータを保存
sessionManager.setSessionData('session-123', 'userId', 'user-456')
const userId = sessionManager.getSessionData('session-123', 'userId')

// セッションを終了してクリーンアップ
await sessionManager.endSession('session-123')

// すべてのセッションをクリア
await sessionManager.clearAll()
```

### カスタム認証

サーバーでユーザー認証を実装：

```typescript
const server = new VoiceServer({
  // ... 設定 ...
})

// WebSocket レベルで認証を処理
const wsServer = server.getSessionManager()

// クライアントが送信: "AUTH:user_id_here"
// サーバーがテキストメッセージとして受信し、userId をセッションに保存
```

クライアント側（M5Stack）：
```cpp
// 接続後に認証を送信
webSocket.sendTXT("AUTH:user_12345");
```

### M5Stack クライアント実装例

PCM ストリーミング用の基本的な M5Stack WebSocket クライアント：

```cpp
#include <WiFi.h>
#include <WebSocketsClient.h>

WebSocketsClient webSocket;

// PCM1 ヘッダー構造体
struct PcmHeader {
    char magic[4];        // "PCM1"
    uint32_t sample_rate; // 16000
    uint8_t channels;     // 1
    uint8_t bits;         // 16
    uint16_t frame_samps; // 320
    uint16_t reserved;    // 0
};

void setup() {
    // WiFi に接続
    WiFi.begin("SSID", "password");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
    }

    // 音声サーバーに接続
    webSocket.begin("192.168.1.100", 3000, "/pcm/stream");
    webSocket.onEvent(webSocketEvent);
}

void loop() {
    webSocket.loop();

    // PCM ヘッダーを送信（ストリーム開始時に一度）
    PcmHeader header = {
        .magic = {'P', 'C', 'M', '1'},
        .sample_rate = 16000,
        .channels = 1,
        .bits = 16,
        .frame_samps = 320,
        .reserved = 0
    };
    webSocket.sendBIN((uint8_t*)&header, sizeof(header));

    // オーディオチャンクを送信
    int16_t audioBuffer[320]; // 16kHz で 20ms
    // ... マイクデータで audioBuffer を埋める ...
    webSocket.sendBIN((uint8_t*)audioBuffer, sizeof(audioBuffer));

    // 完了時に END 信号を送信
    webSocket.sendTXT("END\0");
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
    switch(type) {
        case WStype_TEXT:
            Serial.printf("テキスト: %s\n", payload);
            break;
        case WStype_BIN:
            // オーディオ応答を受信
            playAudio(payload, length);
            break;
    }
}
```

## 設定リファレンス

### WebSocketConfig

```typescript
interface WebSocketConfig {
  port: number                    // リスニングポート（必須）
  host?: string                   // バインドするホスト（デフォルト: '0.0.0.0'）
  path?: string                   // WebSocket パス（デフォルト: '/pcm/stream'）
  pingInterval?: number           // ハートビート間隔（ミリ秒、デフォルト: 15000）
  maxPayload?: number             // 最大メッセージサイズ（バイト、デフォルト: 10MB）
  perMessageDeflate?: boolean     // 圧縮を有効化（デフォルト: false、M5Stack 用）
  skipUTF8Validation?: boolean    // UTF-8 検証をスキップ（デフォルト: true、M5Stack 用）
}
```

### SessionConfig

```typescript
interface SessionConfig {
  maxBytes?: number         // セッション最大サイズ（バイト、デフォルト: 5MB）
  maxDurationMs?: number    // セッション最大継続時間（ミリ秒、デフォルト: 60秒）
  maxChunks?: number        // 最大オーディオチャンク数（デフォルト: 200）
  idleTimeoutMs?: number    // アイドルタイムアウト（ミリ秒、デフォルト: 5秒）
}
```

### PipelineConfig

```typescript
interface PipelineConfig {
  transcription: TranscriptionPlugin    // 音声→テキスト変換プラグイン
  conversation: ConversationPlugin      // LLM 会話プラグイン
  synthesis: SynthesisPlugin            // テキスト→音声変換プラグイン
  verbose?: boolean                     // デバッグログを有効化（デフォルト: false）
}
```

## トラブルシューティング

### M5Stack 接続問題

**問題**: WebSocket 接続が失敗または即座に切断される

**解決策**:
- サーバー設定で `perMessageDeflate: false` を確認
- サーバー設定で `skipUTF8Validation: true` を確認
- M5Stack とサーバー間のネットワーク接続を確認
- M5Stack コード内のサーバー IP とポートを確認
- サーバーのファイアウォールルールを確認

### オーディオ品質問題

**問題**: オーディオが歪む、または途切れる

**解決策**:
- クライアントとサーバー両方でサンプルレートが一致していることを確認（推奨: 16kHz）
- ネットワークの安定性を確認 - WiFi 信号強度
- 低遅延のため `frame_samps` を減らす（例: 160サンプル = 10ms）
- セッション統計でドロップされたチャンクを監視
- M5Stack で十分なバッファサイズを確保

### 文字起こし失敗

**問題**: 文字起こしが null または空を返す

**解決策**:
- API キーが正しく設定されているか確認
- オーディオフォーマットが正しいか確認（16kHz、16ビット、モノラル）
- 十分なオーディオ継続時間を確保（最低約0.5秒）
- API レート制限とクォータを確認
- デバッグログのため `verbose: true` を有効化

### メモリ問題

**問題**: サーバーがクラッシュまたはメモリ不足になる

**解決策**:
- セッション設定で `maxBytes` を減らす
- セッション設定で `maxChunks` を減らす
- セッションが適切に終了していることを確認
- コールバックでセッションクリーンアップを監視
- `idleTimeoutMs` を使用して古いセッションをクリーンアップ

## API リファレンス

完全な API ドキュメントについては、[TypeScript 型定義](./src/types/index.ts) と [ソースコード](./src/) を参照してください。

## ライセンス

MIT

## リポジトリ

https://github.com/tetra-mix/esp-voice-server

## 作者

tetra-mix
