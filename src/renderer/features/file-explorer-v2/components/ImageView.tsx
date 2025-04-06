import React, { useState, useEffect } from "react";
import { FSEntry } from "@/types";
import { ZoomIn, ZoomOut, RotateCw } from "lucide-react";
import { Button } from "@/renderer/shared/components/Button";

interface ImageViewProps {
  selectedNode: FSEntry;
}

const ImageView: React.FC<ImageViewProps> = ({ selectedNode }) => {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [imageData, setImageData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadImage = async () => {
      if (!selectedNode || !selectedNode.realPath) {
        setError("Image not found or cannot be displayed");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const result = await window.fileExplorer.getImageData(selectedNode.realPath);
        
        if (result.success) {
          setImageData(result.dataUrl);
          setError(null);
        } else {
          setError(result.error || "Failed to load image");
        }
      } catch (err) {
        console.error("Error loading image:", err);
        setError("Failed to load image");
      } finally {
        setLoading(false);
      }
    };

    loadImage();
  }, [selectedNode]);

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 0.25, 0.25));
  };

  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        Loading image...
      </div>
    );
  }

  if (error || !imageData) {
    return (
      <div className="flex justify-center items-center h-full">
        {error || "Image not found or cannot be displayed"}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-muted/20">
      <div className="border-b border-border p-3 flex justify-between items-center">
        <h2 className="text-lg font-medium">{selectedNode.name}</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleZoomOut} title="Zoom Out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={handleZoomIn} title="Zoom In">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={handleRotate} title="Rotate">
            <RotateCw className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        <img 
          src={imageData}
          alt={selectedNode.name}
          style={{ 
            transform: `scale(${zoom}) rotate(${rotation}deg)`,
            maxHeight: '100%',
            maxWidth: '100%',
            transition: 'transform 0.2s ease'
          }}
          className="object-contain"
        />
      </div>
    </div>
  );
};

export default ImageView; 