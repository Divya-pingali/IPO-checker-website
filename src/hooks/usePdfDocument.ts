import { useState, useEffect, useRef } from 'react';
import type * as PDFJSType from 'pdfjs-dist';

// Type alias for the PDF document proxy
export type PDFDocumentProxy = PDFJSType.PDFDocumentProxy;

interface UsePdfDocumentResult {
  pdfDoc: PDFDocumentProxy | null;
  numPages: number;
  loading: boolean;
  error: string | null;
}

/**
 * Load a PDF from a URL using PDF.js.
 * Returns the document proxy so callers can getPage(), getTextContent(), etc.
 */
export function usePdfDocument(url: string): UsePdfDocumentResult {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const taskRef = useRef<PDFJSType.PDFDocumentLoadingTask | null>(null);

  useEffect(() => {
    if (!url) return;
    setLoading(true);
    setError(null);
    setPdfDoc(null);

    // Import pdfjs-dist lazily so the worker URL is set up before first use
    import('pdfjs-dist').then((pdfjs) => {
      // Worker path — Vite copies the file from node_modules into assets
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.js',
          import.meta.url,
        ).toString();
      }

      const task = pdfjs.getDocument({
        url,
        cMapUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/cmaps/',
        cMapPacked: true,
      });
      taskRef.current = task;

      task.promise
        .then((doc) => {
          setPdfDoc(doc);
          setNumPages(doc.numPages);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name === 'MissingPDFException') {
            setError('PDF file not found at: ' + url);
          } else {
            setError(err instanceof Error ? err.message : String(err));
          }
          setLoading(false);
        });
    });

    return () => {
      taskRef.current?.destroy().catch(() => {});
    };
  }, [url]);

  return { pdfDoc, numPages, loading, error };
}
