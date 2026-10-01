import Image from "next/image";

type MaxiusLogoProps = {
  className?: string;
};

export default function MaxiusLogo({ className = "" }: MaxiusLogoProps) {
  return (
    <Image
      src="/Logo/Logo_backroundNO.png"
      alt="Maxius"
      width={278}
      height={307}
      priority
      className={`object-contain ${className}`}
    />
  );
}

export function MaxiusMark({ className = "" }: MaxiusLogoProps) {
  return (
    <Image
      src="/Logo/maxius-mark.png"
      alt="Maxius"
      width={208}
      height={203}
      priority
      className={`object-contain ${className}`}
    />
  );
}
