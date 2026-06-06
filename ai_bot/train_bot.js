import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import * as tf from '@tensorflow/tfjs';

// .env 파일 로드 (루트 폴더)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("❌ 에러: .env 파일에 VITE_SUPABASE_URL 또는 VITE_SUPABASE_ANON_KEY가 설정되어 있지 않습니다.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const BUCKET_NAME = 'sign-dataset';

// 모델 설정
const FRAMES_PER_SEQUENCE = 30;
const FEATURES_PER_FRAME = 126;

// 저장 경로
const PUBLIC_MODEL_DIR = path.resolve(process.cwd(), 'public/model');

// Hex to String 디코딩
const decodeHex = (hexStr) => {
  try {
    if (/^[0-9a-fA-F]+$/.test(hexStr)) {
      return Buffer.from(hexStr, 'hex').toString('utf8');
    }
  } catch (e) {}
  return hexStr;
};

// 프레임 당 손 관절 데이터를 126차원(양손 21관절 x,y,z) 배열로 변환
const extractFeatures = (hands) => {
  const features = new Array(FEATURES_PER_FRAME).fill(0);
  if (!hands || hands.length === 0) return features;
  
  const hand1 = hands[0];
  for (let i = 0; i < 21; i++) {
    if (hand1[i]) {
      features[i * 3] = hand1[i].x || 0;
      features[i * 3 + 1] = hand1[i].y || 0;
      features[i * 3 + 2] = hand1[i].z || 0;
    }
  }
  
  if (hands.length > 1) {
    const hand2 = hands[1];
    for (let i = 0; i < 21; i++) {
      if (hand2[i]) {
        features[63 + i * 3] = hand2[i].x || 0;
        features[63 + i * 3 + 1] = hand2[i].y || 0;
        features[63 + i * 3 + 2] = hand2[i].z || 0;
      }
    }
  }
  return features;
};

// 현재 클라우드의 데이터 상태를 가져오는 함수 (모니터링용)
async function getDatasetState() {
  const { data: folders, error } = await supabase.storage.from(BUCKET_NAME).list('skeletons', { limit: 1000 });
  if (error) throw error;
  
  const state = {};
  for (const folder of folders) {
    if (!folder.name || folder.name === '.emptyFolder' || folder.metadata) continue;
    const { data: files } = await supabase.storage.from(BUCKET_NAME).list(`skeletons/${folder.name}`, { limit: 1000 });
    const jsonCount = files ? files.filter(f => f.metadata && f.name.endsWith('.json')).length : 0;
    state[folder.name] = jsonCount;
  }
  return state;
}

// 데이터 다운로드 및 전처리 함수 (스마트 캐싱 적용)
const DATASET_CACHE_DIR = path.resolve(process.cwd(), 'ai_bot/dataset_cache');

async function downloadAndPreprocess() {
  console.log("🚀 클라우드 데이터 동기화 및 전처리를 시작합니다 (스마트 캐싱 가동)...");

  if (!fs.existsSync(DATASET_CACHE_DIR)) {
    fs.mkdirSync(DATASET_CACHE_DIR, { recursive: true });
  }

  const { data: folders, error: rootError } = await supabase.storage.from(BUCKET_NAME).list('skeletons', { limit: 1000 });
  if (rootError) throw rootError;

  const validFolders = folders.filter(f => f.name && f.name !== '.emptyFolder' && !f.metadata);
  
  const X_arr = [];
  const y_arr = [];
  const word_labels = [];
  let downloadedCount = 0;
  let cachedCount = 0;

  for (let i = 0; i < validFolders.length; i++) {
    const hexName = validFolders[i].name;
    const wordName = decodeHex(hexName);
    word_labels.push(wordName);
    
    // 워드별 로컬 폴더 확인 및 생성
    const wordCacheDir = path.join(DATASET_CACHE_DIR, hexName);
    if (!fs.existsSync(wordCacheDir)) {
      fs.mkdirSync(wordCacheDir, { recursive: true });
    }
    
    console.log(`[${i + 1}/${validFolders.length}] '${wordName}' 데이터 동기화 중...`);
    
    const { data: files } = await supabase.storage.from(BUCKET_NAME).list(`skeletons/${hexName}`, { limit: 1000 });
    if (!files) continue;

    const jsonFiles = files.filter(f => f.metadata && f.name.endsWith('.json'));
    
    for (const file of jsonFiles) {
      try {
        const localFilePath = path.join(wordCacheDir, file.name);
        let text;
        
        // 캐시 확인 로직
        if (fs.existsSync(localFilePath)) {
          // 로컬 캐시에서 즉시 읽기
          text = fs.readFileSync(localFilePath, 'utf8');
          cachedCount++;
        } else {
          // 캐시에 없으면 클라우드에서 다운로드
          const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET_NAME).download(`skeletons/${hexName}/${file.name}`);
          if (downloadError) throw downloadError;
          
          text = await blob.text();
          fs.writeFileSync(localFilePath, text, 'utf8'); // 로컬에 영구 저장
          downloadedCount++;
        }
        
        const data = JSON.parse(text);
        
        if (data.length < FRAMES_PER_SEQUENCE) continue;
        
        const sequenceFeatures = [];
        for (let j = 0; j < FRAMES_PER_SEQUENCE; j++) {
          const frame = data[j];
          const hands = frame.hands || [];
          sequenceFeatures.push(extractFeatures(hands));
        }
        
        X_arr.push(sequenceFeatures);
        y_arr.push(i); // label index
      } catch (err) {
        console.error(`Error processing ${file.name}: ${err.message}`);
      }
    }
  }

  console.log(`\n✅ 데이터 전처리 완료!`);
  console.log(`📦 이번에 새로 다운받은 파일: ${downloadedCount}개`);
  console.log(`⚡ 로컬 캐시에서 고속으로 읽은 파일: ${cachedCount}개`);
  console.log(`총 샘플 수: ${X_arr.length}`);
  console.log(`단어 클래스 수: ${word_labels.length} (${word_labels.join(', ')})`);

  return { X_arr, y_arr, word_labels };
}

// Node.js용 커스텀 모델 저장 핸들러 (순수 fs 기반)
const getLocalSaveHandler = (dirPath) => {
  return {
    save: async (modelArtifacts) => {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      // 1. model.json 저장
      const modelJsonPath = path.join(dirPath, 'model.json');
      const modelJson = {
        format: modelArtifacts.format,
        generatedBy: modelArtifacts.generatedBy || `TensorFlow.js v${tf.version_core}`,
        convertedBy: null,
        modelTopology: modelArtifacts.modelTopology,
        weightsManifest: [
          {
            paths: ['weights.bin'],
            weights: modelArtifacts.weightSpecs
          }
        ]
      };
      fs.writeFileSync(modelJsonPath, JSON.stringify(modelJson, null, 2), 'utf8');

      // 2. weights.bin 저장
      if (modelArtifacts.weightData) {
        const weightsBinPath = path.join(dirPath, 'weights.bin');
        const buffer = Buffer.from(modelArtifacts.weightData);
        fs.writeFileSync(weightsBinPath, buffer);
      }

      return {
        modelArtifactsInfo: {
          dateSaved: new Date(),
          modelTopologyType: 'JSON',
          modelTopologyBytes: JSON.stringify(modelArtifacts.modelTopology).length,
          weightSpecsBytes: JSON.stringify(modelArtifacts.weightSpecs).length,
          weightDataBytes: modelArtifacts.weightData ? modelArtifacts.weightData.byteLength : 0
        }
      };
    }
  };
};

// 메인 학습 함수
async function runTraining() {
  const startTime = Date.now();
  
  const { X_arr, y_arr, word_labels } = await downloadAndPreprocess();
  
  if (X_arr.length === 0) {
    console.log("❌ 학습할 데이터가 없습니다. 훈련을 건너뜁니다.");
    return;
  }
  
  const numClasses = word_labels.length;
  
  // 텐서로 변환
  const X = tf.tensor3d(X_arr, [X_arr.length, FRAMES_PER_SEQUENCE, FEATURES_PER_FRAME]);
  const y = tf.oneHot(tf.tensor1d(y_arr, 'int32'), numClasses);

  console.log("🧠 LSTM 딥러닝 모델을 생성합니다...");
  
  const model = tf.sequential();
  model.add(tf.layers.lstm({
    units: 64,
    returnSequences: true,
    activation: 'relu',
    inputShape: [FRAMES_PER_SEQUENCE, FEATURES_PER_FRAME]
  }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.lstm({
    units: 128,
    returnSequences: true,
    activation: 'relu'
  }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.lstm({
    units: 64,
    returnSequences: false,
    activation: 'relu'
  }));
  model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
  model.add(tf.layers.dense({ units: numClasses, activation: 'softmax' }));

  model.compile({
    optimizer: 'adam',
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy']
  });

  model.summary();

  console.log("\n⏳ 훈련을 시작합니다...");
  
  await model.fit(X, y, {
    epochs: 100,
    batchSize: 8,
    validationSplit: 0.2,
    callbacks: tf.callbacks.earlyStopping({ monitor: 'val_loss', patience: 10 }),
    verbose: 1
  });

  console.log("\n📦 웹사이트용(TF.js) 모델로 저장을 시작합니다...");
  
  // 로컬 파일시스템에 저장
  await model.save(getLocalSaveHandler(PUBLIC_MODEL_DIR));
  
  // 레이블 정보 저장
  fs.writeFileSync(
    path.join(PUBLIC_MODEL_DIR, 'word_labels.json'), 
    JSON.stringify(word_labels, null, 2), 
    'utf8'
  );

  // 텐서 메모리 해제
  X.dispose();
  y.dispose();

  const minutes = (Date.now() - startTime) / 60000;
  console.log(`🎉 훈련 및 배포 완료! (소요 시간: ${minutes.toFixed(2)}분)`);
  console.log(`저장 위치: ${PUBLIC_MODEL_DIR}`);
}

// 감시 모드 실행 (이벤트 기반 무전기 수신 모드)
let isTraining = false;

function startWatchMode() {
  console.log("🤖 AI 훈련 봇이 깨어났습니다. (Admin의 훈련 가동 신호 대기 중...)");
  
  const channel = supabase.channel('training_channel');
  
  channel.on('broadcast', { event: 'trigger_training' }, async (payload) => {
    console.log(`\n💡 [${new Date().toLocaleTimeString()}] 프론트엔드로부터 훈련 시작 신호를 수신했습니다!`);
    
    if (isTraining) {
      console.log("⚠️ 이미 훈련이 진행 중입니다. 중복 실행을 무시합니다.");
      return;
    }
    
    isTraining = true;
    try {
      await runTraining();
      console.log("✅ 수동 트리거 학습 완료! 다시 대기 모드로 돌아갑니다.");
    } catch (err) {
      console.error(`⚠️ 학습 중 에러 발생: ${err.message}`);
    } finally {
      isTraining = false;
    }
  }).subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log("📡 Supabase 실시간 무전(Broadcast) 채널에 성공적으로 연결되었습니다.");
    }
  });
}

// 메인 실행 로직 분기
const isWatchMode = process.argv.includes('--watch');
if (isWatchMode) {
  startWatchMode();
} else {
  runTraining().catch(console.error);
}
