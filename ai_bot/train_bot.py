import os
import json
import time
import numpy as np
import requests
from dotenv import load_dotenv
import tensorflow as tf
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau
from tensorflow.keras.utils import to_categorical
from sklearn.model_selection import train_test_split
import tensorflowjs as tfjs

# 1. 환경 변수 로드 (상위 폴더의 .env 파일 사용)
load_dotenv(dotenv_path='../.env')
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("VITE_SUPABASE_ANON_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Supabase 환경 변수가 설정되지 않았습니다. .env 파일을 확인해주세요.")

# 설정값
BUCKET_NAME = 'sign-dataset'
FRAMES_PER_SEQUENCE = 30
FEATURES_PER_FRAME = 126 # 양손 (21 * 3 * 2)

def hex_to_string(hex_str):
    """Hex로 인코딩된 폴더명을 원래 한글 단어로 디코딩"""
    try:
        bytes_obj = bytes.fromhex(hex_str)
        return bytes_obj.decode('utf-8')
    except:
        return hex_str

def list_storage(prefix):
    url = f"{SUPABASE_URL}/storage/v1/object/list/{BUCKET_NAME}"
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    res = requests.post(url, headers=headers, json={"prefix": prefix, "limit": 1000})
    return res.json() if res.status_code == 200 else []

def download_storage(path):
    url = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET_NAME}/{path}"
    res = requests.get(url)
    if res.status_code == 200:
        return res.json()
    url_auth = f"{SUPABASE_URL}/storage/v1/object/authenticated/{BUCKET_NAME}/{path}"
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    res_auth = requests.get(url_auth, headers=headers)
    if res_auth.status_code == 200:
        return res_auth.json()
    raise Exception(f"Failed to download {path}")

def extract_features(hands_data):
    """프레임 당 손 관절 데이터를 126차원(양손 21관절 x,y,z) 배열로 변환"""
    # 기본값: 0으로 채워진 126차원 배열
    features = np.zeros(FEATURES_PER_FRAME)
    
    if not hands_data or len(hands_data) == 0:
        return features
        
    # 첫 번째 손 (0~62 인덱스)
    hand1 = hands_data[0]
    for i, pt in enumerate(hand1):
        if i >= 21: break
        features[i*3] = pt.get('x', 0)
        features[i*3 + 1] = pt.get('y', 0)
        features[i*3 + 2] = pt.get('z', 0)
        
    # 두 번째 손 (63~125 인덱스)
    if len(hands_data) > 1:
        hand2 = hands_data[1]
        for i, pt in enumerate(hand2):
            if i >= 21: break
            features[63 + i*3] = pt.get('x', 0)
            features[63 + i*3 + 1] = pt.get('y', 0)
            features[63 + i*3 + 2] = pt.get('z', 0)
            
    return features

def download_and_preprocess():
    print("🚀 Supabase에서 데이터를 다운로드하고 전처리를 시작합니다...")
    
    res = list_storage('skeletons')
    folders = [item for item in res if item.get('name') and item['name'] != '.emptyFolder']
    
    X = []
    y = []
    word_labels = []
    
    for idx, folder in enumerate(folders):
        hex_name = folder['name']
        word_name = hex_to_string(hex_name)
        word_labels.append(word_name)
        
        print(f"[{idx+1}/{len(folders)}] '{word_name}' 데이터 수집 중...")
        
        files = list_storage(f'skeletons/{hex_name}')
        json_files = [f for f in files if f.get('name') and f['name'].endswith('.json')]
        
        for file in json_files:
            try:
                file_path = f"skeletons/{hex_name}/{file['name']}"
                data = download_storage(file_path)
                
                if len(data) < FRAMES_PER_SEQUENCE:
                    continue
                
                sequence_features = []
                for i in range(FRAMES_PER_SEQUENCE):
                    frame = data[i]
                    hands = frame.get('hands', [])
                    features = extract_features(hands)
                    sequence_features.append(features)
                    
                X.append(sequence_features)
                y.append(idx)
            except Exception as e:
                print(f"Error processing {file['name']}: {e}")
                
    X = np.array(X)
    y = np.array(y)
    
    print(f"\n✅ 데이터 전처리 완료!")
    print(f"총 샘플 수: {len(X)}")
    print(f"단어 클래스 수: {len(word_labels)} ({', '.join(word_labels)})")
    
    y_categorical = to_categorical(y, num_classes=len(word_labels))
    
    with open('word_labels.json', 'w', encoding='utf-8') as f:
        json.dump(word_labels, f, ensure_ascii=False)
        
    return X, y_categorical, word_labels

def build_model(num_classes):
    print("🧠 LSTM 딥러닝 모델을 생성합니다...")
    model = Sequential([
        LSTM(64, return_sequences=True, activation='relu', input_shape=(FRAMES_PER_SEQUENCE, FEATURES_PER_FRAME)),
        Dropout(0.2),
        LSTM(128, return_sequences=True, activation='relu'),
        Dropout(0.2),
        LSTM(64, return_sequences=False, activation='relu'),
        Dense(64, activation='relu'),
        Dense(num_classes, activation='softmax')
    ])
    model.compile(optimizer='adam', loss='categorical_crossentropy', metrics=['accuracy'])
    model.summary()
    return model

def run_training():
    start_time = time.time()
    
    X, y, word_labels = download_and_preprocess()
    
    if len(X) == 0:
        print("❌ 학습할 데이터가 없습니다. 훈련을 건너뜁니다.")
        return
        
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    model = build_model(len(word_labels))
    
    early_stopping = EarlyStopping(monitor='val_loss', patience=10, restore_best_weights=True)
    reduce_lr = ReduceLROnPlateau(monitor='val_loss', factor=0.5, patience=5, min_lr=0.0001)
    
    print("\n⏳ 학습을 시작합니다...")
    model.fit(
        X_train, y_train,
        validation_data=(X_test, y_test),
        epochs=100,
        batch_size=8,
        callbacks=[early_stopping, reduce_lr],
        verbose=1
    )
    
    loss, accuracy = model.evaluate(X_test, y_test)
    print(f"\n📊 최종 평가 결과 - 정확도: {accuracy*100:.2f}%, 손실: {loss:.4f}")
    
    print("\n📦 웹사이트용(TF.js) 모델 변환을 시작합니다...")
    export_dir = '../public/model'
    os.makedirs(export_dir, exist_ok=True)
    
    model.save('temp_model.h5')
    
    print("\n📦 TF.js 포맷으로 변환 중...")
    tfjs.converters.save_keras_model(model, export_dir)
    
    if os.path.exists('temp_model.h5'):
        os.remove('temp_model.h5')
        
    if os.path.exists('word_labels.json'):
        import shutil
        shutil.move('word_labels.json', os.path.join(export_dir, 'word_labels.json'))
        
    end_time = time.time()
    minutes = (end_time - start_time) / 60
    print(f"🎉 훈련 및 배포 완료! (소요 시간: {minutes:.2f}분)")
    print(f"저장 위치: {os.path.abspath(export_dir)}")

def get_dataset_state():
    """클라우드에서 현재 단어별 데이터 세트(JSON) 개수를 파악합니다."""
    res = list_storage('skeletons')
    folders = [item for item in res if item.get('name') and item['name'] != '.emptyFolder']
    
    state = {}
    for folder in folders:
        hex_name = folder['name']
        files = list_storage(f'skeletons/{hex_name}')
        json_count = len([f for f in files if f.get('name') and f['name'].endswith('.json')])
        state[hex_name] = json_count
    return state

def main():
    print("🤖 AI 훈련 봇이 깨어났습니다. (10분마다 새로운 데이터 감지 모드)")
    last_state = {}
    
    while True:
        try:
            print("\n🔍 클라우드 데이터 상태 확인 중...")
            current_state = get_dataset_state()
            should_train = False
            
            for hex_name, count in current_state.items():
                word_name = hex_to_string(hex_name)
                # 데이터가 10세트 이상이고, 이전 기록보다 늘어났다면 훈련 트리거!
                if count >= 10:
                    last_count = last_state.get(hex_name, 0)
                    if count > last_count:
                        print(f"💡 감지됨: '{word_name}' 단어의 데이터가 추가되었습니다! (현재 {count}세트)")
                        should_train = True
                        
            if should_train:
                print("🚀 새로운 데이터가 충분히 모였습니다. 자동 학습을 시작합니다!")
                run_training()
                last_state = current_state
                print("✅ 학습 및 배포 완료! 다시 감시 모드로 들어갑니다.")
            else:
                print("💤 새로운 학습 조건(10세트 이상 변경됨)을 만족하는 데이터가 없습니다.")
                
        except Exception as e:
            print(f"⚠️ 에러 발생 (재시도 대기): {e}")
            
        print("⏳ 10분(600초) 후 다시 검사합니다...")
        time.sleep(600)

if __name__ == "__main__":
    main()