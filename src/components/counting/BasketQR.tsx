import { QRCodeSVG } from 'qrcode.react';

interface BasketQRProps {
  basketId: string;
  productName: string;
  shelfInfo: string;
}

export function BasketQR({ basketId, productName, shelfInfo }: BasketQRProps) {
  return (
    <div className="flex flex-col items-center justify-center p-6 bg-white rounded-lg shadow-sm border border-gray-200">
      <QRCodeSVG value={`BSKT:${basketId}`} size={200} />
      <div className="mt-4 text-center">
        <p className="font-bold text-gray-900 text-lg">{productName}</p>
        <p className="text-gray-500 text-sm mt-1">{shelfInfo}</p>
        <p className="text-xs text-gray-400 mt-2 font-mono">{basketId}</p>
      </div>
      <button 
        className="mt-6 px-4 py-2 bg-teal-600 text-white rounded-md text-sm font-medium hover:bg-teal-700 w-full"
        onClick={() => {
          // Trigger print dialog or generate PDF
          window.print();
        }}
      >
        Print Label
      </button>
    </div>
  );
}
