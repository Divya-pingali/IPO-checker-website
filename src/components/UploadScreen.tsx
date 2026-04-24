import React, { useCallback, useRef, useState } from 'react';
import type { CheckerJson } from '../types';

interface UploadScreenProps {
  onComplete: (data: CheckerJson, pdfBlobUrl: string) => void;
  onHelp: () => void;
}

type Stage = 'idle' | 'converting' | 'extracting' | 'analysing' | 'complete' | 'error';

const STAGE_LABELS: Record<Stage, string> = {
  idle: '',
  converting: 'Converting document…',
  extracting: 'Extracting prospectus sections…',
  analysing: 'Analysing with Gemini API…',
  complete: 'Complete',
  error: 'Error',
};

const STAGE_ORDER: Stage[] = ['converting', 'extracting', 'analysing', 'complete'];

export const UploadScreen: React.FC<UploadScreenProps> = ({ onComplete, onHelp }) => {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<Stage>('idle');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const acceptFile = (f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (ext !== 'pdf' && ext !== 'docx') {
      setError('Only PDF (.pdf) or Word (.docx) files are supported.');
      return;
    }
    setFile(f);
    setError('');
    setStage('idle');
    setMessage('');
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) acceptFile(f);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) acceptFile(f);
  };

  const stopPolling = () => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const handleAnalyse = async () => {
    if (!file) return;
    setError('');
    setStage('extracting');
    setMessage('Uploading document…');

    const formData = new FormData();
    formData.append('file', file);

    let jobId: string;
    try {
      const res = await fetch('/api/analyse', { method: 'POST', body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { job_id: string };
      jobId = data.job_id;
    } catch (err) {
      setStage('error');
      setError(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const blobUrl = URL.createObjectURL(file);

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${jobId}`);
        if (!res.ok) throw new Error(`Status check failed: HTTP ${res.status}`);
        const status = await res.json() as {
          status: string;
          stage: Stage;
          message: string;
          has_result: boolean;
        };

        setStage(status.stage as Stage);
        setMessage(status.message);

        if (status.status === 'complete') {
          stopPolling();
          const resultRes = await fetch(`/api/result/${jobId}`);
          if (!resultRes.ok) throw new Error(`Failed to fetch result: HTTP ${resultRes.status}`);
          const checkerData = await resultRes.json() as CheckerJson;
          setStage('complete');
          onComplete(checkerData, blobUrl);
        } else if (status.status === 'error') {
          stopPolling();
          setStage('error');
          setError(status.message);
          URL.revokeObjectURL(blobUrl);
        }
      } catch (err) {
        stopPolling();
        setStage('error');
        setError(err instanceof Error ? err.message : String(err));
        URL.revokeObjectURL(blobUrl);
      }
    }, 2000);
  };

  const isRunning = stage !== 'idle' && stage !== 'error';
  const canAnalyse = file !== null && !isRunning;

  const formatBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="upload-screen">
      <div className="upload-card">
        {/* Header */}
        <div className="upload-brand">
          <span className="upload-brand__logo">Linklaters</span>
          <span className="upload-brand__sep">|</span>
          <span className="upload-brand__title">IPO Prospectus Checker</span>
          <button className="upload-help-btn" onClick={onHelp} title="Help">?</button>
        </div>

        <p className="upload-subtitle">
          A pre-submission review tool that checks Chapter 18C prospectus disclosures
          against the Meaningful Investment requirement.
        </p>

        {/* Drop zone */}
        <div
          className={`upload-dropzone${dragging ? ' upload-dropzone--active' : ''}${file ? ' upload-dropzone--has-file' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => !isRunning && fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && !isRunning && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx"
            className="upload-dropzone__input"
            onChange={handleFileChange}
            disabled={isRunning}
          />
          {file ? (
            <div className="upload-dropzone__file">
              <span className="upload-dropzone__file-icon">
                {file.name.endsWith('.pdf') ? '📄' : '📝'}
              </span>
              <div className="upload-dropzone__file-info">
                <span className="upload-dropzone__file-name">{file.name}</span>
                <span className="upload-dropzone__file-size">{formatBytes(file.size)}</span>
              </div>
              {!isRunning && (
                <button
                  className="upload-dropzone__remove"
                  onClick={(e) => { e.stopPropagation(); setFile(null); setStage('idle'); }}
                  title="Remove file"
                >
                  ✕
                </button>
              )}
            </div>
          ) : (
            <div className="upload-dropzone__empty">
              <span className="upload-dropzone__icon">⬆</span>
              <span className="upload-dropzone__hint">
                Drag &amp; drop a PDF or Word document here
              </span>
              <span className="upload-dropzone__hint-sub">or click to browse</span>
            </div>
          )}
        </div>

        {/* Analyse button */}
        <button
          className={`upload-btn${isRunning ? ' upload-btn--running' : ''}`}
          onClick={handleAnalyse}
          disabled={!canAnalyse}
        >
          {isRunning ? (
            <>
              <span className="spinner spinner--sm" />
              Analysing…
            </>
          ) : (
            'Analyse'
          )}
        </button>

        {/* Progress steps */}
        {isRunning && (
          <div className="upload-progress">
            {STAGE_ORDER.map((s) => {
              const idx = STAGE_ORDER.indexOf(s);
              const curIdx = STAGE_ORDER.indexOf(stage as Stage);
              const isDone = idx < curIdx || stage === 'complete';
              const isActive = s === stage;
              return (
                <div
                  key={s}
                  className={`upload-step${isDone ? ' upload-step--done' : ''}${isActive ? ' upload-step--active' : ''}`}
                >
                  <span className="upload-step__dot" />
                  <span className="upload-step__label">{STAGE_LABELS[s]}</span>
                </div>
              );
            })}
            <p className="upload-progress__msg">{message}</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="upload-error">
            <strong>Error:</strong> {error}
          </div>
        )}

        <p className="upload-note">
          Accepted formats: PDF, Word (.docx — requires LibreOffice on the server)
        </p>
      </div>
    </div>
  );
};
