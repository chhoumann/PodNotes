import '@testing-library/jest-dom';
import { render } from '@testing-library/svelte';

import Progressbar from './Progressbar.svelte';

test('should render', () => {
    const { container } = render(Progressbar, { props: { value: 0, max: 100}});

    expect(container).toMatchSnapshot();
});