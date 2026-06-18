import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";

export default function SplashScreen() {
  const navigate = useNavigate();
  const { startSession, tableNumber } = useSession();

  const handleReserve = () => {
    startSession();
    navigate("/welcome");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-between px-6 py-10 relative overflow-hidden">
      {/* Background blobs */}
      <div className="absolute -top-20 -left-20 w-72 h-72 bg-secondary-container/30 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -right-20 w-60 h-60 bg-primary-fixed/20 rounded-full blur-3xl pointer-events-none" />

      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm mx-auto gap-6 relative z-10">
        {/* Logo */}
        <div className="w-24 h-24 rounded-full overflow-hidden ring-4 ring-surface-container-lowest shadow-xl">
          <img
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuDNhcHj3Wp4Zq6hNyv5_poqVR_JPYtwDJ2Fe9yVvEFOo_524a0wPfQlnHX-x69P65V2ut3wT8cBAvFfM0gPc44yErQXVFQiJnpIZCXn5X7pIIByPo7gA4AdAJ7-fbDZmVRm1UB5i8QcKYq2snE6CKP1wJ7mAZGRuHQ_NtKLn3rrpxUa4W7wM2Z7s-C8e2xdKG0HB3Sfq_7G4YH8Yt_3oqhKgRoJO-_Jd3pSrQyJ9FlC6oj_vkflsPZlh4om_DKFOYgifhWoDgj8pBM"
            alt="Amber & Grain"
            className="w-full h-full object-cover"
          />
        </div>

        <div className="text-center">
          <h1 className="text-[36px] font-bold text-on-surface font-serif leading-tight">Amber & Grain</h1>
          <p className="text-on-surface-variant text-[15px] mt-1">Coffee & Kitchen</p>
        </div>

        {/* Table badge */}
        <div className="flex items-center gap-2 bg-primary-container text-on-primary-container font-semibold px-5 py-2.5 rounded-full shadow-md">
          <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
            table_restaurant
          </span>
          <span>Table {tableNumber}</span>
        </div>

        <p className="text-on-surface-variant text-[16px] text-center leading-relaxed">
          Scan successful — ready when you are.
        </p>

        <button
          onClick={handleReserve}
          className="w-full bg-primary text-on-primary font-semibold py-4 rounded-full shadow-lg active:scale-[0.98] transition-transform flex items-center justify-center gap-2 text-[16px] mt-2"
        >
          Reserve this table
          <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        </button>
      </div>

      <footer className="relative z-10 text-center text-[12px] text-on-surface-variant/60">
        124 Morning Dew Lane · Open 7am – 3pm
      </footer>
    </div>
  );
}
