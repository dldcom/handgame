import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../utils/supabaseClient';
import { Database, Folder, Edit2, Trash2, ArrowLeft, RefreshCw, Activity, ChevronLeft, Play } from 'lucide-react';
import { HAND_CONNECTIONS } from '../utils/canvasRenderer';

const encodeToHex = (str) => {
  return Array.from(new TextEncoder().encode(str))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

const decodeFromHex = (hex) => {
  try {
    if (/^[0-9a-fA-F]+$/.test(hex)) {
      const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
      const decoded = new TextDecoder('utf-8').decode(bytes);
      if (decoded && !decoded.includes('\ufffd')) {
        return decoded;
      }
    }
    return hex;
  } catch (e) {
    return hex;
  }
};

// JSON 프레임을 캔버스에 그려주는 컴포넌트
const FrameCanvas = ({ hands, frameIndex, totalFrames }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hands) return;
    
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 224, 224);

    if (hands.length === 0) {
      // 손이 감지되지 않은 프레임
      ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
      ctx.fillRect(0, 0, 224, 224);
      ctx.fillStyle = '#FF4A4A';
      ctx.font = '16px Pretendard, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('손 감지 안 됨', 112, 112);
      return;
    }

    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    hands.forEach(handLandmarks => {
      // 0~1 사이의 정규화된 좌표를 224 픽셀 캔버스에 맞춤
      const mapped = handLandmarks.map(pt => ({
        x: pt.x * 224,
        y: pt.y * 224
      }));

      // 뼈대 선 그리기
      ctx.strokeStyle = '#00FF66';
      HAND_CONNECTIONS.forEach(([from, to]) => {
        if (mapped[from] && mapped[to]) {
          ctx.beginPath();
          ctx.moveTo(mapped[from].x, mapped[from].y);
          ctx.lineTo(mapped[to].x, mapped[to].y);
          ctx.stroke();
        }
      });

      // 관절 점 그리기
      ctx.fillStyle = '#FFFFFF';
      mapped.forEach(pt => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3, 0, 2 * Math.PI);
        ctx.fill();
      });
    });
  }, [hands]);

  return (
    <div className="aspect-square bg-black border-4 border-black rounded-xl overflow-hidden relative group shadow-brutal-sm">
      <canvas ref={canvasRef} width={224} height={224} className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-300" />
      <div className="absolute top-1 left-1 bg-white border-2 border-black text-black text-xs font-black px-1.5 rounded-md">
        #{frameIndex + 1}
      </div>
    </div>
  );
};

export default function AdminDashboard() {
  const [folders, setFolders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionStatus, setActionStatus] = useState('');

  // 시퀀스 뷰어 상태
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [sequenceFiles, setSequenceFiles] = useState([]);
  const [selectedSequenceData, setSelectedSequenceData] = useState(null);
  const [isImagesLoading, setIsImagesLoading] = useState(false);

  const fetchFolders = async () => {
    setIsLoading(true);
    setActionStatus('');
    try {
      const { data: rootList, error: rootError } = await supabase.storage
        .from('sign-dataset')
        .list('skeletons', { limit: 1000 });

      if (rootError) throw rootError;

      const folderItems = rootList.filter(item => item.id === null || !item.metadata);
      
      const detailedFolders = await Promise.all(folderItems.map(async (folder) => {
        if (folder.name === '.emptyFolder') return null;
        
        const decodedName = decodeFromHex(folder.name);
        
        const { data: fileList } = await supabase.storage
          .from('sign-dataset')
          .list(`skeletons/${folder.name}`, { limit: 1000 });
          
        // JSON 시퀀스 파일 개수를 카운트 (기존 png가 섞여있다면 .json만 필터링)
        const fileCount = fileList ? fileList.filter(f => f.metadata && f.name.endsWith('.json')).length : 0;
        
        return {
          id: folder.name,
          name: decodedName,
          fileCount
        };
      }));

      const validFolders = detailedFolders.filter(Boolean).sort((a, b) => b.fileCount - a.fileCount);
      setFolders(validFolders);
    } catch (err) {
      console.error("데이터 로드 에러:", err);
      setActionStatus("데이터를 불러오는데 실패했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFolders();
  }, []);

  const handleRename = async (oldFolder) => {
    const newName = window.prompt(`'${oldFolder.name}' 폴더의 올바른 이름을 입력하세요:`, oldFolder.name);
    if (!newName || newName.trim() === '' || newName === oldFolder.name) return;

    const trimmedName = newName.trim();
    const newHex = encodeToHex(trimmedName);

    if (newHex === oldFolder.id) return; 

    setIsLoading(true);
    setActionStatus(`'${oldFolder.name}'을(를) '${trimmedName}'(으)로 변경 중...`);

    try {
      const { data: files, error: listError } = await supabase.storage
        .from('sign-dataset')
        .list(`skeletons/${oldFolder.id}`, { limit: 1000 });
        
      if (listError) throw listError;

      const realFiles = files.filter(f => f.metadata);

      if (realFiles.length === 0) {
        alert("이동할 파일이 없습니다.");
        setIsLoading(false);
        setActionStatus('');
        return;
      }

      let movedCount = 0;
      for (const file of realFiles) {
        const oldPath = `skeletons/${oldFolder.id}/${file.name}`;
        const newPath = `skeletons/${newHex}/${file.name}`;
        const { error: moveError } = await supabase.storage.from('sign-dataset').move(oldPath, newPath);
        if (moveError) {
          console.error(`이동 실패: ${file.name}`, moveError);
        } else {
          movedCount++;
        }
      }

      setActionStatus(`✨ 이름 변경 완료! (${movedCount}개 파일 이동됨)`);
      fetchFolders();
    } catch (err) {
      console.error("이름 변경 에러:", err);
      setActionStatus("이름 변경 중 에러가 발생했습니다.");
      setIsLoading(false);
    }
  };

  const handleDelete = async (folder) => {
    if (!window.confirm(`정말 '${folder.name}' 폴더와 안에 있는 ${folder.fileCount}개의 시퀀스를 모두 삭제하시겠습니까?\n이 작업은 복구할 수 없습니다.`)) return;

    setIsLoading(true);
    setActionStatus(`'${folder.name}' 삭제 중...`);

    try {
      const { data: files, error: listError } = await supabase.storage
        .from('sign-dataset')
        .list(`skeletons/${folder.id}`, { limit: 1000 });
        
      if (listError) throw listError;

      const allFiles = files.map(f => `skeletons/${folder.id}/${f.name}`);

      if (allFiles.length > 0) {
        const { error: removeError } = await supabase.storage.from('sign-dataset').remove(allFiles);
        if (removeError) throw removeError;
      }

      setActionStatus(`✨ 삭제 완료!`);
      fetchFolders();
    } catch (err) {
      console.error("삭제 에러:", err);
      setActionStatus("삭제 중 에러가 발생했습니다.");
      setIsLoading(false);
    }
  };

  // 폴더 클릭 시 시퀀스 파일 목록 조회
  const handleViewSequences = async (folder) => {
    setSelectedFolder(folder);
    setSequenceFiles([]);
    setSelectedSequenceData(null);
    setIsImagesLoading(true);
    setActionStatus('');

    try {
      const { data: files, error: listError } = await supabase.storage
        .from('sign-dataset')
        .list(`skeletons/${folder.id}`, { limit: 100, sortBy: { column: 'name', order: 'asc' } });
        
      if (listError) throw listError;
      
      const realFiles = files.filter(f => f.metadata && f.name.endsWith('.json'));
      setSequenceFiles(realFiles.map(f => f.name));
    } catch (err) {
      console.error("파일 로드 에러:", err);
      setActionStatus("시퀀스 목록을 불러오는데 실패했습니다.");
    } finally {
      setIsImagesLoading(false);
    }
  };

  // 특정 시퀀스(JSON) 파일 열람
  const loadSequenceData = async (fileName) => {
    setIsImagesLoading(true);
    try {
      const path = `skeletons/${selectedFolder.id}/${fileName}`;
      const { data, error } = await supabase.storage.from('sign-dataset').download(path);
      
      if (error) throw error;
      
      const text = await data.text();
      const jsonData = JSON.parse(text);
      setSelectedSequenceData({ name: fileName, frames: jsonData });
    } catch (err) {
      console.error("JSON 다운로드 에러:", err);
      alert("데이터를 읽어오는 중 에러가 발생했습니다.");
    } finally {
      setIsImagesLoading(false);
    }
  };

  // 수동 훈련 트리거 함수 (Supabase Broadcast 활용)
  const triggerTraining = async () => {
    setActionStatus('📡 서버로 훈련 시작 신호를 전송하는 중...');
    
    const channel = supabase.channel('training_channel');
    
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        const res = await channel.send({
          type: 'broadcast',
          event: 'trigger_training',
          payload: { timestamp: new Date().toISOString() },
        });
        
        if (res === 'ok') {
          setActionStatus('✨ 훈련 명령 전송 완료! 백엔드 서버에서 학습을 시작했습니다.');
        } else {
          setActionStatus('❌ 훈련 명령 전송에 실패했습니다.');
        }
        
        // 전송 후 즉시 무전기(채널) 해제
        supabase.removeChannel(channel);
      }
    });
  };

  return (
    <div className="min-h-screen bg-slate-100 p-6 md:p-12 font-sans flex flex-col items-center">
      <div className="w-full max-w-[1000px]">
        <header className="w-full bg-black text-white border-4 border-black rounded-3xl p-6 md:p-8 mb-8 flex flex-col md:flex-row items-center justify-between gap-4 shadow-[8px_8px_0px_0px_rgba(71,181,255,1)]">
          <div className="flex items-center gap-4 text-left w-full">
            <Database size={40} className="text-[#00FF66] shrink-0" />
            <div>
              <h1 className="text-2xl md:text-3xl font-black">수어 데이터셋 관리자</h1>
              <p className="text-slate-300 font-bold mt-1 text-sm md:text-base">JSON 좌표 기반 시계열 데이터 관리 패널</p>
            </div>
          </div>
          <button 
            onClick={() => window.location.hash = ''}
            className="flex items-center justify-center gap-2 bg-white text-black border-2 border-black px-4 py-2 rounded-xl font-black hover:bg-slate-200 transition-colors w-full md:w-auto shrink-0 shadow-[2px_2px_0px_0px_rgba(255,255,255,0.5)]"
          >
            <ArrowLeft size={18} /> 학생용 화면으로
          </button>
        </header>

        {actionStatus && (
          <div className="bg-[#47B5FF] text-black font-bold p-4 rounded-2xl border-4 border-black mb-6 animate-pulse shadow-brutal-sm">
            ℹ️ {actionStatus}
          </div>
        )}

        {/* 뷰 분기 처리 */}
        {!selectedFolder ? (
          // --- 폴더 목록 뷰 ---
          <div className="w-full bg-white border-4 border-black rounded-3xl p-6 shadow-brutal">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 border-b-4 border-black pb-4">
              <h2 className="text-2xl font-black">📂 저장된 수어 데이터 목록</h2>
              <div className="flex items-center gap-3">
                <button 
                  onClick={triggerTraining}
                  className="flex items-center gap-2 bg-[#00FF66] border-2 border-black px-4 py-2 rounded-xl font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#00e65c] active:translate-x-0.5 active:translate-y-0.5 transition-all"
                >
                  🚀 훈련 가동하기
                </button>
                <button 
                  onClick={fetchFolders}
                  disabled={isLoading}
                  className="flex items-center gap-2 bg-[#FFFF00] border-2 border-black px-4 py-2 rounded-xl font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 transition-transform"
                >
                  <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} /> 새로고침
                </button>
              </div>
            </div>

            {isLoading && folders.length === 0 ? (
              <div className="text-center py-12 text-lg font-black text-slate-500">
                데이터를 불러오는 중입니다...
              </div>
            ) : folders.length === 0 ? (
              <div className="text-center py-12 text-lg font-black text-slate-500">
                아직 저장된 JSON 데이터가 없습니다.
              </div>
            ) : (
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse min-w-[700px]">
                  <thead>
                    <tr className="bg-slate-200 border-b-4 border-black">
                      <th className="p-4 font-black text-lg">단어명 (디코딩)</th>
                      <th className="p-4 font-black text-lg text-center">수집 세트 (JSON)</th>
                      <th className="p-4 font-black text-lg text-center">데이터 검수</th>
                      <th className="p-4 font-black text-lg text-right">관리 기능</th>
                    </tr>
                  </thead>
                  <tbody>
                    {folders.map(folder => (
                      <tr key={folder.id} className="border-b-2 border-slate-300 hover:bg-slate-50 transition-colors">
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <Folder className="text-[#00FF66] fill-black stroke-[2px] shrink-0" size={32} />
                            <div>
                              <span className="text-xl font-black block">{folder.name}</span>
                              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block mt-0.5">Hex: {folder.id}</span>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 text-center">
                          <div className="inline-block bg-slate-100 border-2 border-black px-3 py-1 rounded-full font-black text-sm">
                            {folder.fileCount} <span className="text-slate-500 text-xs">/ 10 세트</span>
                          </div>
                        </td>
                        <td className="p-4 text-center">
                          <button 
                            onClick={() => handleViewSequences(folder)}
                            className="bg-[#47B5FF] text-black px-3 py-2 border-2 border-black rounded-xl font-black inline-flex items-center gap-1 hover:bg-[#34a3eb] transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-px active:translate-y-px"
                          >
                            <Activity size={18} /> 데이터 보기
                          </button>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center justify-end gap-2">
                            <button 
                              onClick={() => handleRename(folder)}
                              className="bg-black text-white px-3 py-2 border-2 border-black rounded-xl font-bold flex items-center gap-1 hover:bg-slate-800 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)] active:translate-x-px active:translate-y-px"
                            >
                              <Edit2 size={16} /> 수정
                            </button>
                            <button 
                              onClick={() => handleDelete(folder)}
                              className="bg-[#FF4A4A] text-white px-3 py-2 border-2 border-black rounded-xl font-bold flex items-center gap-1 hover:bg-red-600 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)] active:translate-x-px active:translate-y-px"
                            >
                              <Trash2 size={16} /> 삭제
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          // --- 시퀀스(JSON) 뷰어 ---
          <div className="w-full bg-white border-4 border-black rounded-3xl p-6 shadow-brutal animate-in fade-in zoom-in-95 duration-300">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 border-b-4 border-black pb-4">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => { setSelectedFolder(null); setSelectedSequenceData(null); }}
                  className="bg-slate-200 hover:bg-slate-300 text-black p-2 border-2 border-black rounded-full transition-colors"
                >
                  <ChevronLeft size={24} />
                </button>
                <h2 className="text-2xl font-black flex items-center gap-2">
                  <Activity className="text-[#00FF66] fill-black stroke-[2px]" size={28} />
                  '{selectedFolder.name}' 데이터 검수
                </h2>
              </div>
              <div className="bg-[#FFFF00] border-2 border-black px-4 py-1.5 rounded-full font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] text-sm">
                총 {sequenceFiles.length}세트
              </div>
            </div>

            {isImagesLoading && !selectedSequenceData ? (
              <div className="flex flex-col items-center justify-center py-20 text-black">
                <RefreshCw size={48} className="animate-spin mb-4" />
                <p className="text-xl font-black">시퀀스 목록을 불러오는 중...</p>
              </div>
            ) : sequenceFiles.length === 0 ? (
              <div className="text-center py-20 text-xl font-black text-slate-500 bg-slate-50 rounded-2xl border-4 border-dashed border-slate-300">
                수집된 JSON 세트가 없습니다.
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                
                {/* 시퀀스 파일 선택기 */}
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {sequenceFiles.map((file, idx) => (
                    <button
                      key={idx}
                      onClick={() => loadSequenceData(file)}
                      className={`whitespace-nowrap px-4 py-2 border-2 border-black rounded-xl font-black text-sm flex items-center gap-2 transition-colors ${
                        selectedSequenceData?.name === file 
                          ? 'bg-black text-[#00FF66] shadow-[2px_2px_0px_0px_rgba(0,255,102,1)]' 
                          : 'bg-white text-black hover:bg-slate-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                      }`}
                    >
                      <Play size={14} className={selectedSequenceData?.name === file ? 'fill-[#00FF66]' : ''} />
                      세트 {idx + 1}
                    </button>
                  ))}
                </div>

                {/* 캔버스 렌더링 영역 (가상 3D 뷰어) */}
                {selectedSequenceData && (
                  <div className="bg-slate-100 p-4 rounded-2xl border-2 border-black">
                    <h3 className="text-lg font-black mb-4 flex items-center gap-2">
                      <Database size={18} /> JSON 데이터 렌더링 뷰 (총 {selectedSequenceData.frames.length}프레임)
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                      {selectedSequenceData.frames.map((frame, idx) => (
                        <FrameCanvas key={idx} hands={frame.hands} frameIndex={idx} totalFrames={selectedSequenceData.frames.length} />
                      ))}
                    </div>
                  </div>
                )}
                {!selectedSequenceData && sequenceFiles.length > 0 && (
                  <div className="text-center py-10 font-bold text-slate-500 border-4 border-dashed border-slate-300 rounded-2xl">
                    👆 위의 세트 버튼을 클릭하여 JSON 좌표를 가상 이미지로 렌더링해 보세요.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
