const Footer: React.FC = () => {
  const year = new Date().getFullYear();
  return (
    <div
      style={{
        padding: '16px 24px',
        textAlign: 'center',
        color: 'rgba(0,0,0,0.45)',
        fontSize: 12,
      }}
    >
      启明智联业务管理系统 ©{year}
    </div>
  );
};

export default Footer;