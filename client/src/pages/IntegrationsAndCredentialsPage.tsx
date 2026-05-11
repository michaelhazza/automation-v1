import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface User { id: string; role: string; organisationId?: string }
interface Props { user: User; subaccountId?: string; embedded?: boolean }

export default function IntegrationsAndCredentialsPage(_: Props) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/connections', { replace: true });
  }, [navigate]);
  return null;
}
