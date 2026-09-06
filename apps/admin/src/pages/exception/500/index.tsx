import { Link } from '@umijs/max';
import { Button, Card, Result } from 'antd';
import React from 'react';

const Exception500: React.FC = () => (
  <Card variant="borderless">
    <Result
      status="500"
      title="500"
      subTitle="抱歉，服务器出了点问题。"
      extra={
        <Link to="/">
          <Button type="primary">返回首页</Button>
        </Link>
      }
    />
  </Card>
);

export default Exception500;