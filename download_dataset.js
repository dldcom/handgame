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
const WORD_MAP = [
  { id: 'hello', korean: '안녕하세요' },
  { id: 'thankyou', korean: '감사합니다' },
  { id: 'love', korean: '사랑합니다' },
  { id: 'congratulations', korean: '축하합니다' },
  { id: 'sorry', korean: '죄송합니다' }
];
const OUTPUT_DIR = path.join(process.cwd(), 'downloaded_dataset');

async function downloadDataset() {
  console.log("🚀 Supabase Storage로부터 뼈대 이미지셋 다운로드를 시작합니다...");

  // 1. 다운로드 대상 루트 폴더 생성
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
  }

  for (const item of WORD_MAP) {
    const wordDir = path.join(OUTPUT_DIR, item.korean);
    if (!fs.existsSync(wordDir)) {
      fs.mkdirSync(wordDir);
    }

    console.log(`\n📂 '${item.korean}' 폴더 파일 목록 불러오는 중 (Storage ID: skeletons/${item.id})...`);

    // 2. skeletons/영어ID 폴더 내 파일 목록 가져오기
    const { data: fileList, error: listError } = await supabase.storage
      .from(BUCKET_NAME)
      .list(`skeletons/${item.id}`, {
        limit: 100, // 최대 100장 (목표는 50장)
        sortBy: { column: 'name', order: 'asc' },
      });

    if (listError) {
      console.error(`❌ '${item.korean}' 목록 조회 실패:`, listError.message);
      continue;
    }

    if (!fileList || fileList.length === 0) {
      console.log(`⚠️ '${item.korean}' 폴더에 저장된 이미지가 없습니다.`);
      continue;
    }

    console.log(`▶ 총 ${fileList.length}개의 파일을 다운로드합니다...`);

    // 3. 파일 각각 다운로드 및 로컬 저장
    for (const file of fileList) {
      // .emptyFolder 같은 placeholder 제외
      if (file.name === '.emptyFolder') continue;

      const storagePath = `skeletons/${item.id}/${file.name}`;
      const localFilePath = path.join(wordDir, file.name);

      try {
        const { data: blob, error: downloadError } = await supabase.storage
          .from(BUCKET_NAME)
          .download(storagePath);

        if (downloadError) {
          console.error(`❌ 파일 다운로드 실패 (${file.name}):`, downloadError.message);
          continue;
        }

        // Blob 데이터를 Buffer로 변환하여 파일 쓰기
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(localFilePath, buffer);
      } catch (err) {
        console.error(`❌ 파일 저장 실패 (${file.name}):`, err);
      }
    }
    console.log(`✅ '${item.korean}' 다운로드 완료! -> ${wordDir}`);
  }

  console.log(`\n🎉 모든 다운로드가 완료되었습니다!`);
  console.log(`📂 저장된 폴더 경로: ${OUTPUT_DIR}`);
}

downloadDataset();
