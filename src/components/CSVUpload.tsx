import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Upload, FileText, AlertTriangle } from 'lucide-react';

interface CSVUploadProps {
  onFileUpload: (data: string[][]) => void;
}

export default function CSVUpload({ onFileUpload }: CSVUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    const file = files[0];
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      setError('Please upload a valid CSV file');
      return;
    }
    
    setFileName(file.name);
    setError(null);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csvData = e.target?.result as string;
        
        // Proper CSV parsing that handles quoted fields
        const parseCSVLine = (line: string): string[] => {
          const result: string[] = [];
          let current = '';
          let inQuotes = false;
          
          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];
            
            if (char === '"') {
              if (inQuotes && nextChar === '"') {
                // Escaped quote
                current += '"';
                i++; // Skip next quote
              } else {
                // Toggle quote state
                inQuotes = !inQuotes;
              }
            } else if (char === ',' && !inQuotes) {
              // Field separator
              result.push(current.trim());
              current = '';
            } else {
              current += char;
            }
          }
          
          // Add last field
          result.push(current.trim());
          return result;
        };
        
        // Split by newlines and parse each line
        const lines = csvData.split(/\r?\n/).filter(line => line.trim());
        const rows = lines.map(line => parseCSVLine(line));
        
        if (rows.length === 0) {
          setError('CSV file is empty');
          setFileName(null);
          return;
        }
        
        onFileUpload(rows);
      } catch (err) {
        setError('Error parsing CSV file. Please check the format.');
        setFileName(null);
      }
    };
    reader.onerror = () => {
      setError('Error reading file');
      setFileName(null);
    };
    reader.readAsText(file);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
  };

  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    handleFiles(e.dataTransfer.files);
  };

  const resetUpload = () => {
    setFileName(null);
    setError(null);
  };

  return (
    <Card className="shadow-lg border-0 bg-gradient-to-br from-white to-gray-50">
      <CardHeader>
        <CardTitle className="text-2xl font-bold flex items-center">
          <Upload className="h-6 w-6 mr-3 text-blue-600" />
          Import Products from CSV
        </CardTitle>
        <CardDescription className="text-lg">
          Upload a CSV file to add multiple products at once
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!fileName ? (
          <div
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-all duration-200
              ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
            `}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              id="csv-upload"
              type="file"
              accept=".csv"
              onChange={handleChange}
              className="hidden"
            />
            <label
              htmlFor="csv-upload"
              className="flex flex-col items-center cursor-pointer group"
            >
              <Upload className="h-12 w-12 text-gray-400 group-hover:text-blue-500 transition-color" />
              <p className="mt-4 text-xl font-medium text-gray-600">
                Click to upload or drag and drop
              </p>
              <p className="mt-2 text-muted-foreground">
                CSV files only
              </p>
            </label>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center p-4 bg-green-50 rounded-xl border border-green-200">
              <FileText className="h-8 w-8 text-green-600 mr-3" />
              <div className="flex-1">
                <p className="font-medium text-green-800">File uploaded successfully</p>
                <p className="text-sm text-green-700">{fileName}</p>
              </div>
              <Button variant="outline" onClick={resetUpload} className="ml-4">
                Upload Another
              </Button>
            </div>
            
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
        
        {error && !fileName && (
          <Alert variant="destructive" className="mt-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}