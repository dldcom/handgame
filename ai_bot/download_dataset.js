import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// .env 파일 로드
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("❌ 에러: .env 파일에 VITE_SUPABASE_URL 또는 VITE_SUPABASE_ANON_KEY가 설정되어 있지 않습니다.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const BUCKET_NAME = 'sign-dataset';
const OUTPUT_DIR = path.join(process.cwd(), 'downloaded_dataset');

async function downloadDataset() {
  console.log("🚀 Supabase Storage로부터 시계열(JSON) 수어 데이터셋 다운로드를 시작합니다...");

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
  }

  console.log("\n📂 클라우드에 저장된 수어 폴더 목록을 검색 중...");

  const { data: rootList, error: rootError } = await supabase.storage
    .from(BUCKET_NAME)
    .list('skeletons', { limit: 1000 });

  if (rootError) {
    console.error("❌ 'skeletons' 루트 폴더 목록 조회 실패:", rootError.message);
    process.exit(1);
  }

  const folders = rootList.filter(item => item.id === null || !item.metadata);

  if (folders.length === 0) {
    console.log("⚠️ 다운로드할 수집 폴더가 존재하지 않습니다.");
    return;
  }

  console.log(`▶ 총 ${folders.length}개의 수어(단어)를 발견했습니다.\n`);

  // 최종 통합을 위한 마스터 데이터 배열
  let masterDataset = {};

  for (const folder of folders) {
    if (folder.name === '.emptyFolder') continue;
    
    let koreanWord = folder.name;
    try {
      if (/^[0-9a-fA-F]+$/.test(folder.name)) {
        const decoded = Buffer.from(folder.name, 'hex').toString('utf8');
        if (decoded && !decoded.includes('\ufffd')) {
          koreanWord = decoded;
        }
      }
    } catch (e) {
      // 복호화 실패 시 원본 유지
    }

    console.log(`📂 '${koreanWord}' 데이터 세트 다운로드 준비 중...`);
    masterDataset[koreanWord] = [];

    const { data: fileList, error: listError } = await supabase.storage
      .from(BUCKET_NAME)
      .list(`skeletons/${folder.name}`, {
        limit: 1000,
        sortBy: { column: 'name', order: 'asc' },
      });

    if (listError) {
      console.error(`❌ '${koreanWord}' 폴더 목록 조회 실패:`, listError.message);
      continue;
    }

    const files = fileList.filter(f => f.metadata && f.name.endsWith('.json'));

    if (files.length === 0) {
      console.log(`   ⚠️ 저장된 JSON 세트가 없습니다. 패스합니다.\n`);
      continue;
    }

    let successCount = 0;
    for (const file of files) {
      const storagePath = `skeletons/${folder.name}/${file.name}`;
      
      try {
        const { data: blob, error: downloadError } = await supabase.storage
          .from(BUCKET_NAME)
          .download(storagePath);

        if (downloadError) {
          console.error(`   ❌ 다운로드 실패 (${file.name}):`, downloadError.message);
          continue;
        }

        const text = await blob.text();
        const jsonData = JSON.parse(text);
        
        // 마스터 데이터셋에 시퀀스 추가
        masterDataset[koreanWord].push({
          sequence_id: file.name.replace('.json', ''),
          frames: jsonData
        });
        
        successCount++;
      } catch (err) {
        console.error(`   ❌ 파일 파싱 에러 (${file.name}):`, err);
      }
    }
    console.log(`   ✅ 완료: 총 ${successCount}/${files.length}세트(JSON) 메모리 로드됨.\n`);
  }

  // 통합 JSON 파일 생성
  console.log(`\n💾 통합 데이터셋(master_dataset.json)을 생성합니다...`);
  const masterFilePath = path.join(OUTPUT_DIR, 'master_dataset.json');
  fs.writeFileSync(masterFilePath, JSON.stringify(masterDataset, null, 2), 'utf8');

  console.log(`🎉 모든 다운로드가 성공적으로 완료되었습니다!`);
  console.log(`📂 텐서플로우 학습용 1 통합 파일 경로: ${masterFilePath}`);
  console.log(`💡 이 단 하나의 JSON 파일만 파이썬(Colab)으로 가져가면 즉시 시계열(LSTM/CNN) 학습이 가능합니다!`);
}

downloadDataset();
